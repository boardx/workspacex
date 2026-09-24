/**
 * Phase 18 F09 —— `KnowledgeReadPort` 的 Postgres 实现。
 *
 * 每个返回内容的方法都把结果包进 `guard()`：调用方（application/knowledge-graph/read-thread-knowledge.ts）
 * 必须交出会话可见性判定才拿得到内容。guard 的 ref 与 chat 读消息用的是同一个（项目，或个人线程），
 * 所以「能读会话的消息 ⇔ 能读会话的知识」在类型上就绑在一起。
 *
 * 每次读都在 withTenant 里设置 app.current_user_id：个人空间的行由 RLS 只放给本人（I-14）。
 */
import { contextPack as CP, knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ClaimSourcesData, KnowledgeReadPort, KnowledgeThreadRef, ThreadKnowledgeData, TurnMemoryData,
} from "../../application/knowledge-graph/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import { KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS } from "./pg-kg-extraction";

type KgClaim = ThreadKnowledgeData["claims"][number];

/** 与 chat 读消息同一个 guard ref（pg-chat-repository.ts findMessages）。 */
const threadRef = (t: KnowledgeThreadRef) => ({ kind: "project" as const, id: t.projectId ?? `personal:${t.threadId}` });

/** 「活着的」结论：未撤销、未被取代（与 F04 kg_live_vertices 同一条口径）。 */
const LIVE_CLAIM = "c.revoked_at IS NULL AND c.status <> 'superseded'";

const CLAIM_COLUMNS = `
  c.id, c.claim_kind, c.statement, c.status, c.confidence, c.created_by, c.reviewed_by,
  c.supersedes_claim_id, c.scope_kind, c.scope_id, c.created_at,
  (SELECT e.dst_id FROM ontology_edges e WHERE e.org_id = c.org_id AND e.src_kind = 'claim' AND e.src_id = c.id
     AND e.dst_kind = 'claim' AND e.relation = 'derived_from' AND e.status = 'active' LIMIT 1) AS derived_from,
  ARRAY(SELECT e.dst_id FROM ontology_edges e WHERE e.org_id = c.org_id AND e.src_kind = 'claim' AND e.src_id = c.id
     AND e.dst_kind = 'object' AND e.relation = 'about' AND e.status = 'active' ORDER BY e.dst_id) AS about_ids,
  (SELECT count(*) FROM claim_segments s WHERE s.claim_id = c.id AND s.stance = 'supporting')
    + (SELECT count(*) FROM claim_message_evidence m WHERE m.claim_id = c.id AND m.stance = 'supporting') AS supporting,
  (SELECT count(*) FROM claim_segments s WHERE s.claim_id = c.id AND s.stance = 'contradicting')
    + (SELECT count(*) FROM claim_message_evidence m WHERE m.claim_id = c.id AND m.stance = 'contradicting') AS contradicting`;

interface ClaimRow {
  id: string; claim_kind: KgClaim["kind"] | null; statement: string; status: KgClaim["status"];
  confidence: number | null; created_by: KgClaim["createdBy"]; reviewed_by: string | null;
  supersedes_claim_id: string | null; scope_kind: KgClaim["scope"]["kind"]; scope_id: string; created_at: Date;
  derived_from: string | null; about_ids: string[]; supporting: string; contradicting: string;
}

function toClaim(r: ClaimRow): KgClaim | null {
  const triState = KG.claimTriState(r.status);
  if (triState === null) return null;  // superseded 不下发（契约 KgClaim.triState 注释）
  return {
    id: r.id,
    scope: { kind: r.scope_kind, id: r.scope_id },
    kind: r.claim_kind ?? "fact",
    statement: r.statement,
    status: r.status,
    triState,
    confidence: r.confidence ?? 0.5,
    createdBy: r.created_by,
    reviewedBy: r.reviewed_by,
    supersedesClaimId: r.supersedes_claim_id,
    derivedFromClaimId: r.derived_from,
    aboutObjectIds: r.about_ids,
    supportingCount: Number(r.supporting),
    contradictingCount: Number(r.contradicting),
    createdAt: r.created_at.toISOString(),
  };
}

export class PgKnowledgeRead implements KnowledgeReadPort {
  constructor(private readonly db: DatabasePort) {}

  private inTenant<T>(orgId: OrgId, userId: string, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return fn(s);
    });
  }

  async threadKnowledge(orgId: OrgId, userId: string, thread: KnowledgeThreadRef): Promise<Guarded<ThreadKnowledgeData>> {
    const data = await this.inTenant(orgId, userId, async (s): Promise<ThreadKnowledgeData> => {
      const scope = [orgId, thread.threadId];
      const objects = await s.query<{
        id: string; object_kind: ThreadKnowledgeData["objects"][number]["kind"]; name: string; aliases: string[];
        created_by: ThreadKnowledgeData["objects"][number]["createdBy"]; claim_count: string;
      }>(
        `SELECT o.id, o.object_kind, o.name, o.aliases, o.created_by,
                (SELECT count(DISTINCT c.id) FROM ontology_edges e JOIN claims c ON c.id = e.src_id AND c.org_id = e.org_id
                  WHERE e.org_id = o.org_id AND e.src_kind = 'claim' AND e.dst_kind = 'object' AND e.dst_id = o.id
                    AND e.status = 'active' AND ${LIVE_CLAIM}) AS claim_count
           FROM ontology_objects o
          WHERE o.org_id = $1 AND o.scope_kind = 'chat_session' AND o.scope_id = $2 AND o.merged_into IS NULL
          ORDER BY o.created_at, o.id`, scope,
      );
      const claims = await s.query<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS} FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND ${LIVE_CLAIM}
          ORDER BY c.created_at, c.id`, scope,
      );
      const liveClaims = claims.rows.map(toClaim).filter((c): c is KgClaim => c !== null);
      const live = new Set([...objects.rows.map((o) => `object:${o.id}`), ...liveClaims.map((c) => `claim:${c.id}`)]);
      const edges = await s.query<{
        id: string; src_kind: "object" | "claim"; src_id: string; dst_kind: "object" | "claim"; dst_id: string;
        relation: ThreadKnowledgeData["edges"][number]["relation"]; created_by: ThreadKnowledgeData["edges"][number]["createdBy"];
      }>(
        `SELECT id, src_kind, src_id, dst_kind, dst_id, relation, created_by FROM ontology_edges
          WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND status = 'active'
            AND src_kind IN ('object', 'claim') AND dst_kind IN ('object', 'claim')
          ORDER BY created_at, id`, scope,
      );
      const revision = await s.query<{ n: string }>(
        `SELECT count(*) AS n FROM ontology_actions
          WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND outcome = 'accepted'`, scope,
      );
      const queue = await s.query<{ message_id: string; attempts: number; locked: boolean }>(
        `SELECT message_id, attempts,
                (locked_at IS NOT NULL AND locked_at >= now() - make_interval(secs => $3)) AS locked
           FROM kg_extraction_queue WHERE org_id = $1 AND thread_id = $2 ORDER BY enqueued_at`,
        [...scope, KG_EXTRACTION_LEASE_SECONDS],
      );
      const failed = queue.rows.filter((q) => q.attempts >= KG_EXTRACTION_MAX_ATTEMPTS);
      const active = queue.rows.filter((q) => q.attempts < KG_EXTRACTION_MAX_ATTEMPTS);
      return {
        revision: Number(revision.rows[0]!.n),
        objects: objects.rows.map((o) => ({
          id: o.id, scope: { kind: "chat_session" as const, id: thread.threadId }, kind: o.object_kind, name: o.name,
          aliases: o.aliases, createdBy: o.created_by, claimCount: Number(o.claim_count),
        })),
        claims: liveClaims,
        edges: edges.rows
          .filter((e) => live.has(`${e.src_kind}:${e.src_id}`) && live.has(`${e.dst_kind}:${e.dst_id}`))
          .map((e) => ({
            id: e.id, src: { kind: e.src_kind, id: e.src_id }, dst: { kind: e.dst_kind, id: e.dst_id },
            relation: e.relation, createdBy: e.created_by,
          })),
        ingestion: {
          queued: active.filter((q) => !q.locked).length,
          running: active.filter((q) => q.locked).length,
          failed: failed.length,
          failures: failed.map((q) => ({ sourceKind: "chat_message" as const, sourceRef: q.message_id, reason: "retries_exhausted" as const })),
        },
      };
    });
    return guard(threadRef(thread), data);
  }

  async claimRoute(orgId: OrgId, userId: string, claimId: string) {
    return this.inTenant(orgId, userId, async (s) => {
      const r = await s.query<{ scope_kind: KgClaim["scope"]["kind"]; scope_id: string }>(
        `SELECT scope_kind, scope_id FROM claims c WHERE c.org_id = $1 AND c.id = $2 AND c.scope_kind IS NOT NULL AND ${LIVE_CLAIM}`,
        [orgId, claimId],
      );
      const row = r.rows[0];
      return row === undefined ? null : { scopeKind: row.scope_kind, scopeId: row.scope_id };
    });
  }

  async claimEvidenceThreads(orgId: OrgId, userId: string, claimId: string): Promise<readonly string[]> {
    return this.inTenant(orgId, userId, async (s) => {
      const r = await s.query<{ thread_id: string }>(
        `SELECT DISTINCT m.thread_id FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
          WHERE e.org_id = $1 AND e.claim_id = $2 ORDER BY m.thread_id`, [orgId, claimId],
      );
      return r.rows.map((x) => x.thread_id);
    });
  }

  async claimSources(orgId: OrgId, userId: string, claimId: string, thread: KnowledgeThreadRef, onlyThreads?: readonly string[]): Promise<Guarded<ClaimSourcesData> | null> {
    const data = await this.inTenant(orgId, userId, async (s): Promise<ClaimSourcesData | null> => {
      const c = await s.query<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM claims c WHERE c.org_id = $1 AND c.id = $2`, [orgId, claimId]);
      const claim = c.rows[0] === undefined ? null : toClaim(c.rows[0]);
      if (claim === null) return null;
      const messages = await s.query<{ message_id: string; stance: "supporting" | "contradicting"; excerpt: string }>(
        `SELECT m.message_id, m.stance, m.excerpt FROM claim_message_evidence m
          WHERE m.org_id = $1 AND m.claim_id = $2
            AND ($3::text[] IS NULL OR EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.id = m.message_id AND cm.org_id = m.org_id AND cm.thread_id = ANY($3::text[])))
          ORDER BY m.stance DESC, m.created_at`, [orgId, claimId, onlyThreads ?? null],
      );
      const segments = await s.query<{ segment_id: string; stance: "supporting" | "contradicting"; version_id: string; content: string | null; page: string | null }>(
        `SELECT cs.segment_id, cs.stance, sg.artifact_version_id AS version_id, st.content,
                (SELECT a.locator FROM anchors a WHERE a.segment_id = cs.segment_id AND a.kind = 'page' LIMIT 1) AS page
           FROM claim_segments cs
           JOIN segments sg ON sg.id = cs.segment_id AND sg.org_id = cs.org_id
           LEFT JOIN segment_text st ON st.segment_id = cs.segment_id
          WHERE cs.org_id = $1 AND cs.claim_id = $2 AND $3::text[] IS NULL ORDER BY cs.stance DESC, cs.segment_id`, [orgId, claimId, onlyThreads ?? null],
      );
      const actions = await s.query<{ created_at: Date; actor_kind: "human" | "model" | "system"; actor_id: string; action_type: string; pipeline_version: string | null }>(
        `SELECT created_at, actor_kind, actor_id, action_type, pipeline_version FROM ontology_actions
          WHERE org_id = $1 AND outcome = 'accepted' AND payload->'claims' @> jsonb_build_array(jsonb_build_object('id', $2::text))
          ORDER BY created_at, id`, [orgId, claimId],
      );
      const page = (p: string | null) => {
        const n = p === null ? NaN : Number.parseInt(p, 10);
        return Number.isInteger(n) && n > 0 ? { page: n } : null;
      };
      return {
        claim,
        evidence: [
          ...messages.rows.map((m) => ({
            segmentId: m.message_id, stance: m.stance, sourceKind: "chat_message" as const, sourceRef: m.message_id,
            excerpt: m.excerpt, locator: null, revoked: false,
          })),
          ...segments.rows.map((g) => ({
            segmentId: g.segment_id, stance: g.stance, sourceKind: "attachment" as const, sourceRef: g.version_id,
            excerpt: (g.content ?? "").slice(0, 280), locator: page(g.page), revoked: false,
          })),
        ],
        // 模型 / 系统产生的动作对用户统一显示为「系统」（契约 actor.kind 只有 human | system）。
        provenance: actions.rows.map((a) => ({
          at: a.created_at.toISOString(),
          actor: { kind: a.actor_kind === "human" ? "human" as const : "system" as const, id: a.actor_id },
          action: a.action_type,
          pipelineVersion: a.pipeline_version,
        })),
      };
    });
    return data === null ? null : guard(threadRef(thread), data);
  }

  async turnMemory(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, messageId: string): Promise<Guarded<TurnMemoryData>> {
    const data = await this.inTenant(orgId, userId, async (s): Promise<TurnMemoryData> => {
      // 一轮 = 这条回答 + 它前面紧邻的那条用户消息（记下的东西大多来自用户说的话）。
      const turn = await s.query<{ id: string }>(
        // 只从本会话里取这条消息：别的会话的 messageId 查不到任何东西（不泄露存在性，I-3）。
        `WITH me AS (SELECT created_at, id FROM chat_messages WHERE org_id = $1 AND thread_id = $2 AND id = $3)
         SELECT me.id FROM me
         UNION
         SELECT p.id FROM (
           SELECT m.id FROM chat_messages m, me
            WHERE m.org_id = $1 AND m.thread_id = $2 AND m.author_kind = 'human' AND (m.created_at, m.id) < (me.created_at, me.id)
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) p`,
        [orgId, thread.threadId, messageId],
      );
      const ids = turn.rows.map((r) => r.id);
      const captured = await s.query<{ id: string; statement: string }>(
        `SELECT DISTINCT c.id, c.statement, c.created_at FROM claims c
           JOIN claim_message_evidence m ON m.claim_id = c.id AND m.org_id = c.org_id
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND ${LIVE_CLAIM}
            AND m.stance = 'supporting' AND m.message_id = ANY($3::text[])
          ORDER BY c.created_at, c.id`,
        [orgId, thread.threadId, ids],
      );
      const pending = await s.query<{ n: string }>(
        "SELECT count(*) AS n FROM kg_extraction_queue WHERE org_id = $1 AND thread_id = $2 AND message_id = ANY($3::text[]) AND attempts < $4",
        [orgId, thread.threadId, ids, KG_EXTRACTION_MAX_ATTEMPTS],
      );
      const recall = await readTurnRecall(s, orgId, userId, thread.threadId, messageId);
      return {
        messageId,
        captured: captured.rows.map((c) => ({ claimId: c.id, statement: c.statement })),
        pending: Number(pending.rows[0]!.n) > 0,
        prompt: null,  // U-4 / U-5 的主动卡片在 uc-18-6 落地
        ...recall,
      };
    });
    return guard(threadRef(thread), data);
  }
}

type RecalledMemory = TurnMemoryData["recalled"][number];
interface StoredRecallItem {
  claimId: string; channels: string[]; retrievalReasons: string[]; score: number;
  graphPath: { src: string; relation: string; dst: string }[] | null;
}

/**
 * F13：这条回答用到的记忆。按查看者重新读 canonical：只要本会话的、或查看者本人个人空间的活结论
 * （别人的个人空间 RLS 本来就读不到，这里再按 scope_id 限定一次）；已失效的自然不在。
 * 图路径的端点换成查看者看得到的名字；有一端看不到就整条不给。
 */
async function readTurnRecall(
  s: TenantSession, orgId: OrgId, viewer: string, threadId: string, messageId: string,
): Promise<Pick<TurnMemoryData, "recalled" | "recallDegraded">> {
  const r = await s.query<{ items: StoredRecallItem[]; graph_degraded: boolean }>(
    `SELECT r.items, r.graph_degraded FROM kg_turn_recalls r
       JOIN chat_messages m ON m.org_id = r.org_id AND m.agent_run_id = r.run_id
      WHERE m.org_id = $1 AND m.thread_id = $2 AND m.id = $3 AND r.thread_id = $2`,
    [orgId, threadId, messageId],
  );
  const row = r.rows[0];
  if (row === undefined) return { recalled: [], recallDegraded: false };
  const visible = `((c.scope_kind = 'chat_session' AND c.scope_id = $3) OR (c.scope_kind = 'personal' AND c.scope_id = $4))`;
  const claimKeys = new Set(row.items.map((i) => i.claimId));
  const objectKeys = new Set<string>();
  for (const i of row.items) for (const h of i.graphPath ?? []) for (const k of [h.src, h.dst]) {
    const [kind, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    if (kind === "claim") claimKeys.add(id); else if (kind === "object") objectKeys.add(id);
  }
  const claims = await s.query<{ id: string; statement: string; status: string; scope_kind: "chat_session" | "personal"; said_at: Date | null }>(
    `SELECT c.id, c.statement, c.status, c.scope_kind,
            (SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
              WHERE e.claim_id = c.id AND e.stance = 'supporting') AS said_at
       FROM claims c
      WHERE c.org_id = $1 AND c.id = ANY($2::text[]) AND ${LIVE_CLAIM} AND ${visible}`,
    [orgId, [...claimKeys], threadId, viewer],
  );
  const objects = await s.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM ontology_objects c
      WHERE c.org_id = $1 AND c.id = ANY($2::text[]) AND c.merged_into IS NULL AND ${visible}`,
    [orgId, [...objectKeys], threadId, viewer],
  );
  const claimById = new Map(claims.rows.map((c) => [c.id, c]));
  const label = new Map<string, string>([
    ...claims.rows.map((c) => [`claim:${c.id}`, c.statement] as const),
    ...objects.rows.map((o) => [`object:${o.id}`, o.name] as const),
  ]);
  const recalled: RecalledMemory[] = [];
  for (const item of row.items) {
    const c = claimById.get(item.claimId);
    const tri = c === undefined ? null : KG.claimTriState(c.status as Parameters<typeof KG.claimTriState>[0]);
    if (c === undefined || tri === null) continue;
    let graphPath: RecalledMemory["graphPath"] = null;
    if (item.graphPath !== null && item.graphPath.length > 0) {
      const hops = item.graphPath.map((h) => {
        const relation = KG.KgRelation.safeParse(h.relation);
        const from = label.get(h.src);
        const to = label.get(h.dst);
        return relation.success && from !== undefined && to !== undefined ? { from, relation: relation.data, to } : null;
      });
      graphPath = hops.every((h) => h !== null) ? hops as NonNullable<(typeof hops)[number]>[] : null;
    }
    recalled.push({
      claimId: c.id, statement: c.statement, triState: tri, scope: c.scope_kind,
      saidAt: c.said_at?.toISOString() ?? null,
      channels: item.channels.filter((x): x is RecalledMemory["channels"][number] => CP.RetrievalChannel.safeParse(x).success),
      retrievalReasons: item.retrievalReasons.filter((x): x is RecalledMemory["retrievalReasons"][number] => CP.FilterAction.safeParse(x).success),
      score: item.score,
      graphPath,
    });
  }
  return { recalled, recallDegraded: row.graph_degraded };
}
