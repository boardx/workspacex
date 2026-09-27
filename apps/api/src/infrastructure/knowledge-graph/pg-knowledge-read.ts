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
  ClaimSourcesData, KnowledgeReadPort, KnowledgeThreadRef, MessageExtractionData, PersonalClaimOriginRow,
  OrgKnowledgeData, PersonalKnowledgeData, ProjectKnowledgeData, ThreadKnowledgeCounts, ThreadKnowledgeData, TurnMemoryData,
} from "../../application/knowledge-graph/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import { claimExpired } from "../../domain/knowledge-graph/claim-time";
import { chainReplaced, type ReplacedLink } from "../../domain/knowledge-graph/supersede-chain";
import { KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS } from "./pg-kg-extraction";

type KgClaim = ThreadKnowledgeData["claims"][number];

/** 与 chat 读消息同一个 guard ref（pg-chat-repository.ts findMessages）。 */
const threadRef = (t: KnowledgeThreadRef) => ({ kind: "project" as const, id: t.projectId ?? `personal:${t.threadId}` });

/** 本人个人空间的 guard ref —— 与 resolve-visibility 个人线程判定用的合成 id 同一个（`personal:<userId>`）。 */
export const personalSpaceRef = (userId: string) => ({ kind: "project" as const, id: `personal:${userId}` });
/** B2-S4：组织记忆的 guard ref —— 同 `personalSpaceRef` 的做法（组织记忆没有 acl_bindings 行），合成 id `org:<orgId>`。 */
export const orgSpaceRef = (orgId: OrgId) => ({ kind: "project" as const, id: `org:${orgId}` });

/** 「活着的」结论：未撤销、未被取代（与 F04 kg_live_vertices 同一条口径）。 */
const LIVE_CLAIM = "c.revoked_at IS NULL AND c.status <> 'superseded'";

const CLAIM_COLUMNS = `
  c.id, c.claim_kind, c.statement, c.status, c.confidence, c.created_by, c.reviewed_by,
  c.supersedes_claim_id, c.scope_kind, c.scope_id, c.created_at, c.valid_to, c.todo_status, c.due_at,
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
  valid_to: Date | null; todo_status: KG.KgTodoStatus | null; due_at: Date | null;
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
    // issue #4363（S6）：时间维度。「已过期」只有 claimExpired 一处判定（召回同一个函数）。
    validUntil: r.valid_to?.toISOString() ?? null,
    expired: claimExpired(r.valid_to?.toISOString() ?? null, new Date()),
    todoStatus: r.todo_status,
    dueAt: r.due_at?.toISOString() ?? null,
  };
}

export class PgKnowledgeRead implements KnowledgeReadPort {
  /**
   * 用户直接交办更正（2026-09-25，issue #4178 基础上再收窄一次）—— `providerConfigured`
   * 是 `KgExtractionModelConfig.enabled` 的现值（部署有没有配置抽取用的模型），构造时定住：
   * 这是进程启动参数，不会在一次请求的生命周期里变，这一半继续按老办法传值进来。
   *
   * 部署开关（`kg_extraction_state.enabled`）不能再这样定住——它现在是平台管理员随时可能
   * 切换的落库状态，而 `KNOWLEDGE_READ_PORT` 在 DI 里是**单例**（`kernel.module.ts` 没有
   * `scope: Scope.REQUEST`，整个进程生命周期只构造一次），构造时读一次就会把"管理员刚
   * 打开/关闭"这件事对所有后续请求都冻在构造那一刻的值上。所以 `threadKnowledge` 里每次
   * 调用都直接在已经开着的 tenant session 里现查一次这张表（它没有 RLS、全库一行，
   * `app_rw` 有 SELECT 权限）——不经 `KgDeploymentExtractionSettingsPort`：那个端口内部走
   * `withoutTenant()`，会从连接池另取一条连接，这里已经在同一个 session 里，直接查更省
   * 一次连接；`extractionActive` 紧接着还要再查一次 `kg_org_extraction_settings`，这个文件
   * 本来就是直接按表名查、不经 `KgOrgExtractionSettingsPort`，两处手法保持一致。
   */
  constructor(
    private readonly db: DatabasePort,
    private readonly providerConfigured: boolean,
  ) {}

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
      // issue #4350：分桶与认领条件（`pg-kg-extraction.ts` 的 claim）对齐——
      //   running = 租约还活着（不论第几次：第 3 次尝试进行中的行以前被算成「失败」）；
      //   failed  = 次数用完 AND 没有活着的租约（认领条件 `attempts < 3` 再也不会放出它）；
      //   queued  = 其余：次数没用完、没人持有（含退避中、含租约已过期等着被重新认领的）。
      const running = queue.rows.filter((q) => q.locked);
      const failed = queue.rows.filter((q) => !q.locked && q.attempts >= KG_EXTRACTION_MAX_ATTEMPTS);
      const queued = queue.rows.filter((q) => !q.locked && q.attempts < KG_EXTRACTION_MAX_ATTEMPTS);
      // 用户直接交办更正（2026-09-25）：这个会话所在组织现在是不是真的在抽——provider 已配置
      // AND 部署开关打开了 AND 该组织没关（`kg_org_extraction_settings`，默认值见 `KgOrgExtractionSettingsPort.getEnabled`）。
      // 与触发器 `kg_enqueue_extraction` 的三道闸门同一条件，供面板区分「队列空 = 已整理到
      // 最新」与「压根没开」。provider 没配置时短路，不必再查库。
      // 部署开关直接在这个已开着的 tenant session 里查（`kg_extraction_state` 没有 RLS、
      // 全库一行，`app_rw` 有 SELECT 权限），不经 `this.deploymentExtraction`——那个端口内部
      // 走 `withoutTenant()`，会从连接池另取一条连接，这里已经在同一个 session 里，直接查
      // 更省一次连接（`PgKgDeploymentExtractionSettings` 头注：供平台级 controller 用，
      // 不要求这里的读法必须走它）。
      const deployment = this.providerConfigured
        ? await s.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton")
        : null;
      const deploymentCapable = deployment !== null && (deployment.rows[0]?.enabled ?? false);
      const orgSetting = deploymentCapable
        ? await s.query<{ enabled: boolean }>(
            "SELECT enabled FROM kg_org_extraction_settings WHERE org_id = $1", [orgId],
          )
        : null;
      const extractionActive = orgSetting !== null && (orgSetting.rows[0]?.enabled ?? true);
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
          queued: queued.length,
          running: running.length,
          failed: failed.length,
          failures: failed.map((q) => ({ sourceKind: "chat_message" as const, sourceRef: q.message_id, reason: "retries_exhausted" as const })),
        },
        extractionActive,
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
      const conflict = await readTurnConflict(s, orgId, userId, thread.threadId, ids);
      // I-18：一轮至多一张主动卡，冲突卡优先。用户明确要求的「记住 / 忘掉」卡不丢：矛盾处理完（提醒不再 open），
      // 同一轮回答下就轮到它。
      const card = conflict === null ? await readTurnMemoryCard(s, orgId, userId, thread.threadId, messageId) : null;
      // #4290：改口取代提示是一行附注，不占主动卡的名额（I-18 只管卡片）
      const supersede = await readTurnSupersede(s, orgId, userId, thread.threadId, ids);
      return {
        messageId,
        captured: captured.rows.map((c) => ({ claimId: c.id, statement: c.statement })),
        pending: Number(pending.rows[0]!.n) > 0,
        prompt: conflict !== null ? { type: "conflict" as const, conflict } : card !== null ? { type: "memory_card" as const, card } : null,
        supersede,
        ...recall,
      };
    });
    return guard(threadRef(thread), data);
  }

  /**
   * issue #4180 —— 这条消息自己刚被抽取出的、还活着的结论。只认这一条消息自己的证据
   * （`claim_message_evidence.message_id` 精确相等，`stance = 'supporting'`），不像
   * `turnMemory` 那样向前扩展到「最近一条人类消息」——这里问的就是这一条消息本身产生了什么。
   *
   * 隔离：`EXISTS` 子句要求 `messageId` 真的属于 `(orgId, threadId)`——伪造 / 跨会话的
   * messageId（哪怕字面上等于别的会话某条真实消息的 id）查不到这一行，`claims` 恒为空；
   * `scope_kind = 'chat_session' AND scope_id = $2` 还额外保证了即使跳过这层
   * 也只会看见挂在**这个**会话下的结论，不会读到别的会话的结论内容——两层防御，同
   * `claimSources`/`turnMemory` 对「消息必须先查得到才有下文」的既有纪律。
   *
   * issue #4271 —— `messageId` 也可以是**请求者自己**发的那条人类消息的 `client_message_id`。
   * 本会话刚发出去的用户消息在前端只有视图 id（= 发送时带上的 `clientMessageId`）：身份索引
   * （`copilotkit-v2-message-identity.ts`）只把 assistant 的流式 id 映射到落库 id，从不映射
   * 人类消息，于是反馈条拿着 `clientMessageId` 来问，旧查询按 `cm.id` 精确相等永远查不到，
   * 反馈条恒不出现（真浏览器复现，round 3）。别名只认 `author_kind = 'human' AND author_id = 请求者`：
   * 别人的 `clientMessageId` 解析不出任何消息，不扩大可见面。
   */
  async messageExtraction(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, messageId: string): Promise<Guarded<MessageExtractionData>> {
    const data = await this.inTenant(orgId, userId, async (s): Promise<MessageExtractionData> => {
      // 不用 DISTINCT：join 键 (claim_id, message_id, stance) 恰是 claim_message_evidence 的主键，
      // 一条 claim 对同一条消息、同一个 stance 至多一行证据，天然不会重复。
      // issue #4283 `personal_copy`：**请求者本人**个人空间里、由这条结论自动记下（derived_from 边 created_by = model）、
      // 仍是「AI 记下的」（proposed）那一份——反馈条据此显示「已记入个人记忆」并给撤销。scope_id = 请求者本人，
      // RLS 也只放本人的个人空间（I-14）：别人看这条消息，读不到作者的个人空间，这一列恒为 null。
      const r = await s.query<{ id: string; statement: string; claim_kind: KG.KgClaimKind | null; personal_copy: string | null }>(
        `WITH msg AS (
           SELECT cm.id FROM chat_messages cm
            WHERE cm.org_id = $1 AND cm.thread_id = $2
              AND (cm.id = $3 OR (cm.author_kind = 'human' AND cm.author_id = $4 AND cm.client_message_id::text = $3))
         )
         SELECT c.id, c.statement, c.claim_kind,
                (SELECT p.id FROM ontology_edges d JOIN claims p ON p.id = d.src_id AND p.org_id = d.org_id
                  WHERE d.org_id = c.org_id AND d.relation = 'derived_from' AND d.src_kind = 'claim' AND d.dst_kind = 'claim'
                    AND d.dst_id = c.id AND d.status = 'active' AND d.created_by = 'model'
                    AND p.scope_kind = 'personal' AND p.scope_id = $4 AND p.revoked_at IS NULL AND p.status = 'proposed'
                  ORDER BY p.id LIMIT 1) AS personal_copy
           FROM claims c
           JOIN claim_message_evidence m ON m.claim_id = c.id AND m.org_id = c.org_id
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND ${LIVE_CLAIM}
            AND m.stance = 'supporting' AND m.message_id IN (SELECT id FROM msg)
          ORDER BY c.created_at, c.id`,
        [orgId, thread.threadId, messageId, userId],
      );
      return {
        claims: r.rows.map((x) => ({ claimId: x.id, statement: x.statement, kind: x.claim_kind ?? "fact", personalCopyClaimId: x.personal_copy })),
      };
    });
    return guard(threadRef(thread), data);
  }

  async personalKnowledge(orgId: OrgId, userId: string): Promise<Guarded<PersonalKnowledgeData>> {
    const data = await this.inTenant(orgId, userId, async (s): Promise<PersonalKnowledgeData> => {
      // 只读本人的个人空间：scope_id 限定为本人（RLS 也只把 personal 行放给 app.current_user_id，I-14）。
      const scope = [orgId, userId];
      const objects = await s.query<{
        id: string; object_kind: PersonalKnowledgeData["objects"][number]["kind"]; name: string; aliases: string[];
        created_by: PersonalKnowledgeData["objects"][number]["createdBy"]; claim_count: string;
      }>(
        `SELECT o.id, o.object_kind, o.name, o.aliases, o.created_by,
                (SELECT count(DISTINCT c.id) FROM ontology_edges e JOIN claims c ON c.id = e.src_id AND c.org_id = e.org_id
                  WHERE e.org_id = o.org_id AND e.src_kind = 'claim' AND e.dst_kind = 'object' AND e.dst_id = o.id
                    AND e.status = 'active' AND ${LIVE_CLAIM}) AS claim_count
           FROM ontology_objects o
          WHERE o.org_id = $1 AND o.scope_kind = 'personal' AND o.scope_id = $2 AND o.merged_into IS NULL
          ORDER BY o.created_at, o.id`, scope,
      );
      const claims = await s.query<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS} FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'personal' AND c.scope_id = $2 AND ${LIVE_CLAIM}
          ORDER BY c.created_at, c.id`, scope,
      );
      const liveClaims = claims.rows.map(toClaim).filter((c): c is KgClaim => c !== null);
      const liveObjects = objects.rows.filter((o) => Number(o.claim_count) > 0);
      const live = new Set([...liveObjects.map((o) => `object:${o.id}`), ...liveClaims.map((c) => `claim:${c.id}`)]);
      const edges = await s.query<{
        id: string; src_kind: "object" | "claim"; src_id: string; dst_kind: "object" | "claim"; dst_id: string;
        relation: PersonalKnowledgeData["edges"][number]["relation"]; created_by: PersonalKnowledgeData["edges"][number]["createdBy"];
      }>(
        `SELECT id, src_kind, src_id, dst_kind, dst_id, relation, created_by FROM ontology_edges
          WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND status = 'active'
            AND src_kind IN ('object', 'claim') AND dst_kind IN ('object', 'claim')
          ORDER BY created_at, id`, scope,
      );
      const revision = await s.query<{ n: string }>(
        `SELECT count(*) AS n FROM ontology_actions
          WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND outcome = 'accepted'`, scope,
      );
      const replaced = await readPersonalReplaced(s, orgId, userId, new Map(liveClaims.map((c) => [c.id, c.statement])));
      return {
        revision: Number(revision.rows[0]!.n),
        // 孤立实体（没有活结论引用）不下发（契约 KgObject.claimCount 注释）。
        objects: liveObjects.map((o) => ({
          id: o.id, scope: { kind: "personal" as const, id: userId }, kind: o.object_kind, name: o.name,
          aliases: o.aliases, createdBy: o.created_by, claimCount: Number(o.claim_count),
        })),
        claims: liveClaims,
        edges: edges.rows
          .filter((e) => live.has(`${e.src_kind}:${e.src_id}`) && live.has(`${e.dst_kind}:${e.dst_id}`))
          .map((e) => ({
            id: e.id, src: { kind: e.src_kind, id: e.src_id }, dst: { kind: e.dst_kind, id: e.dst_id },
            relation: e.relation, createdBy: e.created_by,
          })),
        replaced,
      };
    });
    return guard(personalSpaceRef(userId), data);
  }

  async threadKnowledgeSummaries(orgId: OrgId, userId: string, limit: number, offset: number) {
    return this.inTenant(orgId, userId, async (s) => {
      // 候选：本人创建的、有活结论的会话。**不在 SQL 里判可见性**——调用方逐个走 resolveVisibility
      // （同 chat 线程列表 listProjectThreads 的纪律：可见性只有一份实现）。
      const threads = await s.query<{ id: string; project_id: string | null }>(
        `SELECT t.id, t.project_id FROM chat_threads t
          WHERE t.org_id = $1 AND t.created_by = $2
            AND EXISTS (SELECT 1 FROM claims c WHERE c.org_id = t.org_id AND c.scope_kind = 'chat_session' AND c.scope_id = t.id AND ${LIVE_CLAIM})
          ORDER BY t.last_activity_at DESC, t.id LIMIT $3 OFFSET $4`,
        [orgId, userId, limit, offset],
      );
      const ids = threads.rows.map((t) => t.id);
      if (ids.length === 0) return [];
      const statuses = await s.query<{ thread_id: string; status: KgClaim["status"]; n: string }>(
        `SELECT c.scope_id AS thread_id, c.status, count(*) AS n FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = ANY($2::text[]) AND ${LIVE_CLAIM}
          GROUP BY c.scope_id, c.status`,
        [orgId, ids],
      );
      const objects = await s.query<{ thread_id: string; n: string }>(
        `SELECT o.scope_id AS thread_id, count(*) AS n FROM ontology_objects o
          WHERE o.org_id = $1 AND o.scope_kind = 'chat_session' AND o.scope_id = ANY($2::text[]) AND o.merged_into IS NULL
            AND EXISTS (SELECT 1 FROM ontology_edges e JOIN claims c ON c.id = e.src_id AND c.org_id = e.org_id
                         WHERE e.org_id = o.org_id AND e.src_kind = 'claim' AND e.dst_kind = 'object' AND e.dst_id = o.id
                           AND e.status = 'active' AND ${LIVE_CLAIM})
          GROUP BY o.scope_id`,
        [orgId, ids],
      );
      const objectCount = new Map(objects.rows.map((o) => [o.thread_id, Number(o.n)]));
      return threads.rows.map((t) => {
        const counts = { pending: 0, confirmed: 0, conflict: 0 };
        for (const r of statuses.rows) {
          if (r.thread_id !== t.id) continue;
          // 三态投影只有契约 claimTriState 一份实现，SQL 里不另列「哪些状态算待确认」。
          const tri = KG.claimTriState(r.status);
          if (tri !== null) counts[tri] += Number(r.n);
        }
        const row: ThreadKnowledgeCounts = { threadId: t.id, projectId: t.project_id, ...counts, objects: objectCount.get(t.id) ?? 0 };
        return { threadId: t.id, counts: guard(threadRef({ threadId: t.id, projectId: t.project_id }), row) };
      });
    });
  }

  /** 项目中枢 R8：项目记忆（L2）。与 `personalKnowledge` 同一组查询，作用域换成 ('project', projectId)。 */
  async projectKnowledge(orgId: OrgId, userId: string, projectId: string): Promise<Guarded<ProjectKnowledgeData>> {
    return guard({ kind: "project", id: projectId }, await this.sharedScopeKnowledge(orgId, userId, "project", projectId));
  }

  /** B2-S4（issue #4428）：组织记忆（L3）。同一组查询，作用域换成 ('org', orgId)；ref 是组织空间的合成 id。 */
  async orgKnowledge(orgId: OrgId, userId: string): Promise<Guarded<OrgKnowledgeData>> {
    // S10：`sharedFromPersonal` 只属于项目记忆（个人记忆只分享到项目，不直达组织），组织读模型不带它。
    const { revision, objects, claims, edges } = await this.sharedScopeKnowledge(orgId, userId, "org", orgId);
    return guard(orgSpaceRef(orgId), { revision, objects, claims, edges });
  }

  /** 项目记忆 / 组织记忆共用的读：一个共享作用域里的活结论 / 有活结论引用的实体 / 两端都活着的边 / 版本号。 */
  private sharedScopeKnowledge(orgId: OrgId, userId: string, scopeKind: "project" | "org", scopeId: string): Promise<ProjectKnowledgeData> {
    return this.inTenant(orgId, userId, async (s): Promise<ProjectKnowledgeData> => {
      const scope = [orgId, scopeKind, scopeId];
      const objects = await s.query<{
        id: string; object_kind: ProjectKnowledgeData["objects"][number]["kind"]; name: string; aliases: string[];
        created_by: ProjectKnowledgeData["objects"][number]["createdBy"]; claim_count: string;
      }>(
        `SELECT o.id, o.object_kind, o.name, o.aliases, o.created_by,
                (SELECT count(DISTINCT c.id) FROM ontology_edges e JOIN claims c ON c.id = e.src_id AND c.org_id = e.org_id
                  WHERE e.org_id = o.org_id AND e.src_kind = 'claim' AND e.dst_kind = 'object' AND e.dst_id = o.id
                    AND e.status = 'active' AND ${LIVE_CLAIM}) AS claim_count
           FROM ontology_objects o
          WHERE o.org_id = $1 AND o.scope_kind = $2 AND o.scope_id = $3 AND o.merged_into IS NULL
          ORDER BY o.created_at, o.id`, scope,
      );
      const claims = await s.query<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS} FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = $2 AND c.scope_id = $3 AND ${LIVE_CLAIM}
          ORDER BY c.created_at, c.id`, scope,
      );
      const liveClaims = claims.rows.map(toClaim).filter((c): c is KgClaim => c !== null);
      const liveObjects = objects.rows.filter((o) => Number(o.claim_count) > 0);
      const live = new Set([...liveObjects.map((o) => `object:${o.id}`), ...liveClaims.map((c) => `claim:${c.id}`)]);
      const edges = await s.query<{
        id: string; src_kind: "object" | "claim"; src_id: string; dst_kind: "object" | "claim"; dst_id: string;
        relation: ProjectKnowledgeData["edges"][number]["relation"]; created_by: ProjectKnowledgeData["edges"][number]["createdBy"];
      }>(
        `SELECT id, src_kind, src_id, dst_kind, dst_id, relation, created_by FROM ontology_edges
          WHERE org_id = $1 AND scope_kind = $2 AND scope_id = $3 AND status = 'active'
            AND src_kind IN ('object', 'claim') AND dst_kind IN ('object', 'claim')
          ORDER BY created_at, id`, scope,
      );
      const revision = await s.query<{ n: string }>(
        `SELECT count(*) AS n FROM ontology_actions
          WHERE org_id = $1 AND scope_kind = $2 AND scope_id = $3 AND outcome = 'accepted'`, scope,
      );
      // S10（#4367）：由成员从个人记忆分享来的那些 ⇒ 分享人显示名（数据库函数只回名字，不回原件；非项目作用域恒为 NULL）。
      const shared = await s.query<{ id: string; shared_by: string | null }>(
        `SELECT c.id, kg_share_author_name(c.id) AS shared_by FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = $2 AND c.scope_id = $3 AND ${LIVE_CLAIM}
          ORDER BY c.created_at, c.id`, scope,
      );
      return {
        revision: Number(revision.rows[0]!.n),
        sharedFromPersonal: shared.rows.flatMap((r) => (r.shared_by === null ? [] : [{ claimId: r.id, sharedByName: r.shared_by }])),
        objects: liveObjects.map((o) => ({
          id: o.id, scope: { kind: scopeKind, id: scopeId }, kind: o.object_kind, name: o.name,
          aliases: o.aliases, createdBy: o.created_by, claimCount: Number(o.claim_count),
        })),
        claims: liveClaims,
        edges: edges.rows
          .filter((e) => live.has(`${e.src_kind}:${e.src_id}`) && live.has(`${e.dst_kind}:${e.dst_id}`))
          .map((e) => ({
            id: e.id, src: { kind: e.src_kind, id: e.src_id }, dst: { kind: e.dst_kind, id: e.dst_id },
            relation: e.relation, createdBy: e.created_by,
          })),
      };
    });
  }

  async personalClaimOrigins(orgId: OrgId, userId: string) {
    return this.inTenant(orgId, userId, async (s) => {
      const r = await s.query<{
        personal_id: string; source_id: string; thread_id: string; project_id: string | null; said_at: Date | null; auto_copied: boolean;
      }>(
        // said_at 与 readTurnRecall 同一口径（支撑它的最早一条消息）；auto_copied = #4283 自动记下的来源（边由模型建立）。
        `SELECT c.id AS personal_id, src.id AS source_id, t.id AS thread_id, t.project_id, d.created_by = 'model' AS auto_copied,
                (SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
                  WHERE e.claim_id = src.id AND e.stance = 'supporting') AS said_at
           FROM claims c
           JOIN ontology_edges d ON d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id
                                AND d.dst_kind = 'claim' AND d.relation = 'derived_from' AND d.status = 'active'
           JOIN claims src ON src.org_id = d.org_id AND src.id = d.dst_id AND src.scope_kind = 'chat_session' AND src.revoked_at IS NULL
           JOIN chat_threads t ON t.org_id = src.org_id AND t.id = src.scope_id
          WHERE c.org_id = $1 AND c.scope_kind = 'personal' AND c.scope_id = $2 AND ${LIVE_CLAIM}
          ORDER BY c.created_at, c.id, d.created_at, d.id`,
        [orgId, userId],
      );
      return r.rows.map((x) => {
        const row: PersonalClaimOriginRow = {
          personalClaimId: x.personal_id, sourceClaimId: x.source_id, threadId: x.thread_id, projectId: x.project_id,
          saidAt: x.said_at?.toISOString() ?? null, autoCopied: x.auto_copied,
        };
        return { threadId: x.thread_id, origin: guard(threadRef({ threadId: x.thread_id, projectId: x.project_id }), row) };
      });
    });
  }
}

/**
 * issue #4302（人类决定 2026-09-26「折叠的历史」）：查看者本人个人空间里**被改口取代**的旧记忆，挂到取代它的那条活记忆下。
 * 这是 `LIVE_CLAIM` 之外单独的一支投影——活记忆的口径（`claims`）一个字不变，这里只多读「取代」这一种失效：
 *
 *   - #4290 明确改口自动取代（revocation_reason = decision_changed）：经那次取代的提示（kg_supersede_notices，仍是 applied，
 *     撤销快照里有这一条）找到新决定；新决定本身在个人空间、或它在查看者个人空间里的活副本（derived_from）就是挂靠的那条。
 *     提示所在对话是查看者本人的个人对话、且那次改口的新决定本身还活着 ⇒ 给出撤销（同对话里那一行「撤销」：
 *     applyHumanAction{undoSupersede}）；新决定已被忘掉 / 撤回 ⇒ 不给撤销（#4302 review：不引向一次注定落空的撤销）。
 *   - F16 矛盾卡「以新的为准」（conflict_keep_new）：挂靠的是 supersedes_claim_id 指向它的那条活记忆；没有撤销动作 ⇒ 只显示。
 *
 * 忘掉 / 撤回 / 原话被删（user_forgot、user_revoked、source_deleted……）不在这里：人类决定「撤销的不显示」。
 * 取代它的那条也已经不在了 ⇒ 没有可挂靠的，不显示。只按 scope_id = 查看者读（RLS 同样只放本人的个人空间行，I-14）。
 *
 * issue #4363（S6）链式历史：这里只读「每条旧记忆 → **直接**取代它的那条」（successor，可能自己也已被取代），
 * 沿链走到活记忆、排好先后在 domain/knowledge-graph/supersede-chain.ts。successor 的找法：
 *   - decision_changed：新决定本身在查看者个人空间里 ⇒ 就是它；否则是它在查看者个人空间里的副本（derived_from——边可能已经
 *     随副本被再次取代而由 F07 级联失效，所以不要求边活着，活边优先）；被忘掉的副本不算（链到这里断了，不显示）。
 *   - conflict_keep_new：supersedes_claim_id 指向它的那条（活的优先）。
 */
async function readPersonalReplaced(
  s: TenantSession, orgId: OrgId, viewer: string, live: ReadonlyMap<string, string>,
): Promise<PersonalKnowledgeData["replaced"]> {
  const r = await s.query<{ old_id: string; old_statement: string; successor_id: string | null; notice_id: string | null; thread_id: string | null }>(
    `SELECT DISTINCT ON (o.id) o.id AS old_id, o.statement AS old_statement,
            CASE WHEN x.id IS NULL THEN
                   (SELECT l.id FROM claims l
                     WHERE l.org_id = o.org_id AND l.scope_kind = 'personal' AND l.scope_id = $2 AND l.supersedes_claim_id = o.id
                       AND (l.revoked_at IS NULL OR l.status = 'superseded')
                     ORDER BY (l.revoked_at IS NULL) DESC, l.created_at, l.id LIMIT 1)
                 WHEN n.scope_kind = 'personal' AND n.scope_id = $2 THEN n.id
                 ELSE (SELECT p.id FROM ontology_edges d JOIN claims p ON p.org_id = d.org_id AND p.id = d.src_id
                        WHERE d.org_id = o.org_id AND d.src_kind = 'claim' AND d.relation = 'derived_from'
                          AND d.dst_kind = 'claim' AND d.dst_id = n.id
                          AND p.scope_kind = 'personal' AND p.scope_id = $2 AND (p.revoked_at IS NULL OR p.status = 'superseded')
                        ORDER BY (d.status = 'active') DESC, (p.revoked_at IS NULL) DESC, p.created_at, p.id LIMIT 1)
            END AS successor_id,
            CASE WHEN t.id IS NOT NULL AND n.revoked_at IS NULL AND n.status <> 'superseded' THEN x.id END AS notice_id,
            t.id AS thread_id
       FROM claims o
       LEFT JOIN kg_supersede_notices x
              ON x.org_id = o.org_id AND x.status = 'applied' AND o.revocation_reason = 'decision_changed'
             AND x.restore->'claims' @> jsonb_build_array(jsonb_build_object('id', o.id))
       LEFT JOIN claims n ON n.org_id = x.org_id AND n.id = x.newer_claim_id
       LEFT JOIN chat_threads t ON t.org_id = x.org_id AND t.id = x.thread_id AND t.created_by = $2 AND t.project_id IS NULL
      WHERE o.org_id = $1 AND o.scope_kind = 'personal' AND o.scope_id = $2
        AND o.revoked_at IS NOT NULL AND o.status = 'superseded'
        AND o.revocation_reason IN ('decision_changed', 'conflict_keep_new')
        AND (x.id IS NOT NULL OR o.revocation_reason = 'conflict_keep_new')
      ORDER BY o.id, x.created_at DESC`,
    [orgId, viewer],
  );
  const links: ReplacedLink[] = r.rows.flatMap((x) => x.successor_id === null ? [] : [{
    oldClaimId: x.old_id, oldStatement: x.old_statement, successorId: x.successor_id,
    undo: x.notice_id !== null && x.thread_id !== null ? { threadId: x.thread_id, noticeId: x.notice_id } : null,
  }]);
  return chainReplaced(links, live);
}

type ConflictPrompt = Extract<NonNullable<TurnMemoryData["prompt"]>, { type: "conflict" }>["conflict"];

/**
 * F16：这一轮的矛盾提醒（U-5）。挂在这一轮的消息（回答 + 前面那条用户消息）上、还开着、两条都还活着的，
 * 取最早开的那次判定里排第一的一张（I-18 一轮至多一张；其余的冲突两条已是「有矛盾」，在面板里看得到）。
 * 按查看者读：旧条在个人空间时只有本人（scope_id = 查看者）读得到这张卡——RLS 也这么判（kg_conflict_prompts
 * 的可见性跟随两条结论），这里再按作用域限定一次。「你 {日期} 说的」= 旧条最早的原话时间，没有原话时用它入图的时间。
 */
async function readTurnConflict(
  s: TenantSession, orgId: OrgId, viewer: string, threadId: string, turnMessageIds: readonly string[],
): Promise<ConflictPrompt | null> {
  if (turnMessageIds.length === 0) return null;
  const r = await s.query<{
    id: string; kind: "conflict" | "possible_change"; newer_id: string; newer_statement: string; older_id: string; older_statement: string; said_at: Date;
  }>(
    `SELECT p.id, p.kind, n.id AS newer_id, n.statement AS newer_statement, o.id AS older_id, o.statement AS older_statement,
            coalesce((SELECT min(m.created_at) FROM claim_message_evidence e
                        JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
                       WHERE e.claim_id = o.id AND e.org_id = o.org_id AND e.stance = 'supporting'), o.created_at) AS said_at
       FROM kg_conflict_prompts p
       JOIN claims n ON n.id = p.newer_claim_id AND n.org_id = p.org_id
       JOIN claims o ON o.id = p.older_claim_id AND o.org_id = p.org_id
      WHERE p.org_id = $1 AND p.thread_id = $2 AND p.message_id = ANY($3::text[]) AND p.status = 'open'
        AND n.scope_kind = 'chat_session' AND n.scope_id = $2 AND n.revoked_at IS NULL AND n.status <> 'superseded'
        AND o.revoked_at IS NULL AND o.status <> 'superseded'
        AND ((o.scope_kind = 'chat_session' AND o.scope_id = $2) OR (o.scope_kind = 'personal' AND o.scope_id = $4))
      ORDER BY p.created_at, p.rank, p.id
      LIMIT 1`,
    [orgId, threadId, [...turnMessageIds], viewer],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  return {
    promptId: row.id,
    kind: row.kind,
    newerClaim: { id: row.newer_id, statement: row.newer_statement },
    olderClaim: { id: row.older_id, statement: row.older_statement, saidAt: row.said_at.toISOString() },
  };
}

type SupersedeNotice = NonNullable<TurnMemoryData["supersede"]>;

/**
 * #4290：这一轮的改口取代提示（「已用〈新〉取代〈旧〉 · 撤销」）。挂在这一轮的消息上、取最早开的一张。
 * 按查看者读：新决定是本会话的；旧决定是本会话的，或查看者本人个人空间的（RLS 也这么判——提示的可见性跟随两条结论）。
 * applied 只在旧决定现在仍是「因这次改口而失效」时出（别处又改过 ⇒ 这一行说的事已经不成立，不出）；撤销过的读作 undone。
 */
async function readTurnSupersede(
  s: TenantSession, orgId: OrgId, viewer: string, threadId: string, turnMessageIds: readonly string[],
): Promise<SupersedeNotice | null> {
  if (turnMessageIds.length === 0) return null;
  const r = await s.query<{
    id: string; status: "applied" | "undone"; newer_id: string; newer_statement: string; older_id: string; older_statement: string;
  }>(
    `SELECT x.id, x.status, n.id AS newer_id, n.statement AS newer_statement, o.id AS older_id, o.statement AS older_statement
       FROM kg_supersede_notices x
       JOIN claims n ON n.id = x.newer_claim_id AND n.org_id = x.org_id
       JOIN claims o ON o.id = x.older_claim_id AND o.org_id = x.org_id
      WHERE x.org_id = $1 AND x.thread_id = $2 AND x.message_id = ANY($3::text[])
        AND n.scope_kind = 'chat_session' AND n.scope_id = $2
        AND ((o.scope_kind = 'chat_session' AND o.scope_id = $2) OR (o.scope_kind = 'personal' AND o.scope_id = $4))
        AND (x.status = 'undone' OR (o.revoked_at IS NOT NULL AND o.revocation_reason = 'decision_changed'))
      ORDER BY x.created_at, x.id
      LIMIT 1`,
    [orgId, threadId, [...turnMessageIds], viewer],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  return {
    noticeId: row.id,
    newerClaim: { id: row.newer_id, statement: row.newer_statement },
    olderClaim: { id: row.older_id, statement: row.older_statement },
    state: row.status,
  };
}

type MemoryCard = Extract<NonNullable<TurnMemoryData["prompt"]>, { type: "memory_card" }>["card"];
interface StoredCardItem { claimId: string | null; statement: string; scope: "chat_session" | "personal"; basis: string | null }

/**
 * F17：这一轮的「记住 / 忘掉」确认卡（U-4）。经回答的 agent_run_id 找到执行器为这一轮开的那张。
 * 按查看者读：个人空间的条目只给卡的主人（RLS 也这么判——卡上有个人空间条目时只有主人读得到这张卡），
 * 过滤完一条不剩 ⇒ 不出卡。还开着的卡在这里判「过期」（E2）：条目在出卡之后被改过 / 忘掉了 ⇒ stale。
 * 已记住的卡按现在的事实读（rememberedCard）：能不能撤销、长期记忆里还有没有它。
 */
async function readTurnMemoryCard(
  s: TenantSession, orgId: OrgId, viewer: string, threadId: string, messageId: string,
): Promise<MemoryCard | null> {
  const r = await s.query<{
    id: string; kind: MemoryCard["kind"]; items: StoredCardItem[]; status: "open" | "done" | "dismissed"; created_by: string;
    remembered_claim_id: string | null; remembered_personal_id: string | null; claim_created: boolean; personal_created: boolean;
  }>(
    `SELECT k.id, k.kind, k.items, k.status, k.created_by, k.remembered_claim_id, k.remembered_personal_id,
            k.claim_created, k.personal_created FROM kg_memory_cards k
       JOIN chat_messages m ON m.org_id = k.org_id AND m.agent_run_id = k.run_id
      WHERE m.org_id = $1 AND m.thread_id = $2 AND m.id = $3 AND k.thread_id = $2`,
    [orgId, threadId, messageId],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  const items = row.items.filter((i) => i.scope === "chat_session" || row.created_by === viewer);
  if (items.length === 0) return null;
  const ids = items.flatMap((i) => (i.claimId === null ? [] : [i.claimId]));
  const live = await s.query<{ id: string; basis: string }>(
    `SELECT c.id, kg_claim_basis(c.statement) AS basis FROM claims c
      WHERE c.org_id = $1 AND c.id = ANY($2::text[]) AND ${LIVE_CLAIM}
        AND ((c.scope_kind = 'chat_session' AND c.scope_id = $3) OR (c.scope_kind = 'personal' AND c.scope_id = $4))`,
    [orgId, ids, threadId, viewer],
  );
  const basisOf = new Map(live.rows.map((c) => [c.id, c.basis]));
  if (row.status === "open") {
    const stale = items.some((i) => i.claimId !== null && basisOf.get(i.claimId) !== i.basis);
    return { cardId: row.id, kind: row.kind, items: items.map((i) => ({ claimId: i.claimId, statement: i.statement })), state: stale ? "stale" : "open" };
  }
  if (row.kind === "remember" && row.status === "done") return rememberedCard(s, orgId, viewer, row, items[0]!.statement, basisOf);
  return { cardId: row.id, kind: row.kind, state: row.status, items: items.map((i) => ({ claimId: i.claimId, statement: i.statement })) };
}

/**
 * 点过「记住」的卡，按现在的事实说话：
 *   - 长期记忆里的那一条已经不在了（撤销过 / 之后被忘掉）⇒ 读作 dismissed（界面：「这条没有记在长期记忆里」）。
 *     ⚠ 契约里 dismissed 的本意是「不用了」，这里借它表达「现在没有记着」——待人类签核决定
 *     （signoff-draft/chat-knowledge-graph/usecases.md UC-KG-12「待签核确认」）；
 *   - 还在 ⇒ done。claimId 只在「撤销」只会撤掉这次新建的东西时给出：会话结论与长期记忆那条都是这次新建的、
 *     会话结论还活着、长期记忆那条的来源只剩它（撤会话那条，F07 级联把长期记忆那条一起收掉）；否则 null（不给撤销）。
 */
async function rememberedCard(
  s: TenantSession, orgId: OrgId, viewer: string,
  row: { id: string; remembered_claim_id: string | null; remembered_personal_id: string | null; claim_created: boolean; personal_created: boolean },
  statement: string, liveSession: ReadonlyMap<string, string>,
): Promise<MemoryCard> {
  const l1 = await s.query<{ sole: boolean }>(
    `SELECT NOT EXISTS (
              SELECT 1 FROM ontology_edges d JOIN claims src ON src.id = d.dst_id AND src.org_id = d.org_id
               WHERE d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                 AND d.dst_kind = 'claim' AND d.status = 'active' AND src.revoked_at IS NULL AND src.id IS DISTINCT FROM $3) AS sole
       FROM claims c
      WHERE c.org_id = $1 AND c.id = $2 AND ${LIVE_CLAIM} AND c.scope_kind = 'personal' AND c.scope_id = $4`,
    [orgId, row.remembered_personal_id, row.remembered_claim_id, viewer],
  );
  const kept = l1.rows[0];
  if (kept === undefined) return { cardId: row.id, kind: "remember", state: "dismissed", items: [{ claimId: null, statement }] };
  const undoable = row.claim_created && row.personal_created && kept.sole
    && row.remembered_claim_id !== null && liveSession.has(row.remembered_claim_id);
  return { cardId: row.id, kind: "remember", state: "done", items: [{ claimId: undoable ? row.remembered_claim_id : null, statement }] };
}

type RecalledMemory = TurnMemoryData["recalled"][number];
interface StoredRecallItem {
  claimId: string; channels: string[]; retrievalReasons: string[]; score: number | null;
  graphPath: { src: string; relation: string; dst: string }[] | null;
}

/**
 * F13：这条回答用到的记忆。按查看者重新读 canonical：只要本会话的、或查看者本人个人空间的活结论
 * （别人的个人空间 RLS 本来就读不到，这里再按 scope_id 限定一次）；已失效的自然不在。
 * 图路径的端点换成查看者看得到的名字；有一端看不到就整条不给。
 *
 * issue #4284：项目会话里提问者本人的个人记忆也会被召回，而项目会话多人可见。持久化照实记（本人回看要用），
 * **读的时候按查看者过滤**：个人空间的条目（L1、F15 本人其他个人对话里的）只给**这一轮的提问者本人**看——
 * 查看者不是提问者 ⇒ 连它的原文、id、图路径标签都不出（别人的个人空间 RLS 也不放；而查看者自己的个人条目
 * 出现在别人那一轮里只可能是记录被污染，同样不给）。选读侧而不是写侧：对已经落库的旧行、被污染的行同样成立。
 */
async function readTurnRecall(
  s: TenantSession, orgId: OrgId, viewer: string, threadId: string, messageId: string,
): Promise<Pick<TurnMemoryData, "recalled" | "recallDegraded">> {
  const r = await s.query<{ items: StoredRecallItem[]; graph_degraded: boolean; requester_user_id: string }>(
    `SELECT r.items, r.graph_degraded, r.requester_user_id FROM kg_turn_recalls r
       JOIN chat_messages m ON m.org_id = r.org_id AND m.agent_run_id = r.run_id
      WHERE m.org_id = $1 AND m.thread_id = $2 AND m.id = $3 AND r.thread_id = $2`,
    [orgId, threadId, messageId],
  );
  const row = r.rows[0];
  if (row === undefined) return { recalled: [], recallDegraded: false };
  // F15：本人个人对话里的这一轮，还可能用到本人**其他个人对话**里记下的（召回候选同一条件，见 pg-knowledge-recall.ts）。
  const ownPersonal = `EXISTS (SELECT 1 FROM chat_threads here, chat_threads t
      WHERE here.org_id = c.org_id AND here.id = $3 AND here.project_id IS NULL AND here.created_by = $4
        AND t.org_id = c.org_id AND t.id = c.scope_id AND t.project_id IS NULL AND t.created_by = $4 AND NOT t.archived)`;
  // $5：查看者就是这一轮的提问者。个人空间的条目只在这时才可见（issue #4284，见函数头注）。
  // S10（#4367）：项目会话里用到的**本项目**项目记忆（L2）对全体项目成员可见——能读到这一轮的人已经过了会话可见性判定
  // （项目成员），项目记忆本就是给他们的。只认这个会话所属的项目。
  const thisProject = `EXISTS (SELECT 1 FROM chat_threads pt
      WHERE pt.org_id = c.org_id AND pt.id = $3 AND pt.project_id = c.scope_id)`;
  const visible = `((c.scope_kind = 'chat_session' AND c.scope_id = $3)
    OR ($5::boolean AND c.scope_kind = 'personal' AND c.scope_id = $4)
    OR ($5::boolean AND c.scope_kind = 'chat_session' AND ${ownPersonal})
    OR (c.scope_kind = 'project' AND ${thisProject}))`;
  const viewerIsRequester = row.requester_user_id === viewer;
  const claimKeys = new Set(row.items.map((i) => i.claimId));
  const objectKeys = new Set<string>();
  for (const i of row.items) for (const h of i.graphPath ?? []) for (const k of [h.src, h.dst]) {
    const [kind, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    if (kind === "claim") claimKeys.add(id); else if (kind === "object") objectKeys.add(id);
  }
  const claims = await s.query<{
    id: string; statement: string; claim_kind: KG.KgClaimKind | null; status: string; scope_kind: "chat_session" | "personal" | "project";
    said_at: Date | null; shared_by: string | null;
  }>(
    // 别的个人对话里记下的，对这一轮来说是「来自你之前的对话」：按个人空间报（界面据此标「来自你 {日期} 的对话」）。
    `SELECT c.id, c.statement, c.claim_kind, c.status,
            CASE WHEN c.scope_kind = 'chat_session' AND c.scope_id <> $3 THEN 'personal' ELSE c.scope_kind END AS scope_kind,
            (SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
              WHERE e.claim_id = c.id AND e.stance = 'supporting') AS said_at,
            kg_share_author_name(c.id) AS shared_by
       FROM claims c
      WHERE c.org_id = $1 AND c.id = ANY($2::text[]) AND ${LIVE_CLAIM} AND ${visible}`,
    [orgId, [...claimKeys], threadId, viewer, viewerIsRequester],
  );
  const objects = await s.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM ontology_objects c
      WHERE c.org_id = $1 AND c.id = ANY($2::text[]) AND c.merged_into IS NULL AND ${visible}`,
    [orgId, [...objectKeys], threadId, viewer, viewerIsRequester],
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
      claimId: c.id, statement: c.statement, kind: c.claim_kind ?? "fact", triState: tri, scope: c.scope_kind,
      saidAt: c.said_at?.toISOString() ?? null,
      ...(c.scope_kind === "project" && c.shared_by !== null ? { sharedByName: c.shared_by } : {}),
      channels: item.channels.filter((x): x is RecalledMemory["channels"][number] => CP.RetrievalChannel.safeParse(x).success),
      retrievalReasons: item.retrievalReasons.filter((x): x is RecalledMemory["retrievalReasons"][number] => CP.FilterAction.safeParse(x).success),
      // issue #4271：修复前决定类强制召回写进库的是 Infinity → jsonb null；读出来按「没打分」给 0，守住契约。
      score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
      graphPath,
    });
  }
  return { recalled, recallDegraded: row.graph_degraded };
}
