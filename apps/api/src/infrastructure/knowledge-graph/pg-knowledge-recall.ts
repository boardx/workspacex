/**
 * Phase 18 F08 —— `KnowledgeRecallPort` 的 Postgres 实现。
 *
 * 候选集 = 这一轮所在会话（L0）的活结论与实体 ∪ 发起人本人个人空间（L1，F12）的活结论与实体
 * ∪（F15，只在本人个人对话里）本人其他个人对话里记下的活结论与实体。
 * 执行器已经是以发起人身份在这个会话里跑；L1 用 scope_id = 发起人本人限定，读的时候再设
 * app.current_user_id，RLS 也只把个人空间的行放给本人（I-14）——会话里其他成员提问，只得 L0 和他自己的 L1。
 * 图路只拿 id（kg_graph_neighbors），回到候选集求交，图里别的会话 / 别人的 id 不会漏出来。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { KnowledgeRecallPort, TurnRecallRecord } from "../../application/knowledge-graph/ports";
import type { GraphHit, GraphHop, RecallClaim, RecallObject } from "../../domain/knowledge-graph/recall";
import type { OrgId } from "../../domain/org-id";

const stripKind = (key: string) => key.slice(key.indexOf(":") + 1);
const LIVE = "c.revoked_at IS NULL AND c.status <> 'superseded'";
/** 「这条是哪天说的」：最早一条支持证据消息的时间（L1 的证据消息在原会话里）。 */
const CLAIM_COLUMNS = `c.id, c.statement, c.status, c.claim_kind,
  (SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
    WHERE e.claim_id = c.id AND e.stance = 'supporting') AS said_at`;

export class PgKnowledgeRecall implements KnowledgeRecallPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, userId: string, threadId: string) {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      type Row = { id: string; statement: string; status: string; claim_kind: RecallClaim["kind"] | null; said_at: Date | null };
      const session = await s.query<Row>(
        `SELECT ${CLAIM_COLUMNS} FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND ${LIVE}`,
        [orgId, threadId],
      );
      // L1 只进发起人**自己的个人线程**（无项目、本人创建；uc-18-4 R5）：在项目会话里用了，
      // 回答贴在会话里，别的成员就读到了、还会被抽取进本会话的 L0。
      const own = await s.query(
        `SELECT 1 FROM chat_threads t WHERE t.org_id = $1 AND t.id = $2 AND t.project_id IS NULL AND t.created_by = $3`,
        [orgId, threadId, userId],
      );
      const inPersonalThread = own.rows.length === 1;
      // L1：已从本会话晋升出去、而本会话的原结论还在的，不再重复一份（原结论已经在上面了）。
      const personal = !inPersonalThread ? { rows: [] as Row[] } : await s.query<Row>(
        `SELECT ${CLAIM_COLUMNS} FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'personal' AND c.scope_id = $3 AND ${LIVE}
            AND NOT EXISTS (
              SELECT 1 FROM ontology_edges d JOIN claims src ON src.id = d.dst_id AND src.org_id = d.org_id
               WHERE d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                 AND d.status = 'active' AND src.scope_kind = 'chat_session' AND src.scope_id = $2
                 AND src.revoked_at IS NULL AND src.status <> 'superseded')`,
        [orgId, threadId, userId],
      );
      // F15（06-UX R2 M1 / R3-1「零负担获益」、E1）：本人**其他个人对话**里记下的也算个人空间（S0-2=A：个人空间 = 同一用户
      // 全部个人线程），不必先点「记到我的长期记忆」才跨会话被记起。只在本人的个人对话里用（同上面 L1 的条件）；
      // 长期记忆里有过这件事（由这一条晋升出去的，或说法相同的一条——不论现在还在不在），由长期记忆那边说了算：
      // 还在 ⇒ 用长期记忆那条（上面已取）；被忘掉了 ⇒ 这条也不再跨会话出现（否则在别的会话里说「忘掉」，它会从原会话绕回来）。
      const ownOther = !inPersonalThread ? { rows: [] as (Row & { thread_id: string })[] } : await s.query<Row & { thread_id: string }>(
        `SELECT ${CLAIM_COLUMNS}, c.scope_id AS thread_id FROM claims c
           JOIN chat_threads t ON t.org_id = c.org_id AND t.id = c.scope_id
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id <> $2 AND ${LIVE}
            AND t.project_id IS NULL AND t.created_by = $3 AND NOT t.archived
            AND NOT EXISTS (
              SELECT 1 FROM ontology_edges d JOIN claims l1 ON l1.id = d.src_id AND l1.org_id = d.org_id
               WHERE d.org_id = c.org_id AND d.dst_kind = 'claim' AND d.dst_id = c.id AND d.relation = 'derived_from'
                 AND l1.scope_kind = 'personal' AND l1.scope_id = $3)
            AND NOT EXISTS (
              SELECT 1 FROM claims p
               WHERE p.org_id = c.org_id AND p.scope_kind = 'personal' AND p.scope_id = $3
                 AND kg_claim_basis(p.statement) = kg_claim_basis(c.statement))`,
        [orgId, threadId, userId],
      );
      const objects = await s.query<{ id: string; name: string; aliases: string[] }>(
        `SELECT id, name, aliases FROM ontology_objects
          WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND merged_into IS NULL`,
        [orgId, threadId],
      );
      const personalObjects = !inPersonalThread ? { rows: [] as { id: string; name: string; aliases: string[] }[] } : await s.query<{ id: string; name: string; aliases: string[] }>(
        `SELECT id, name, aliases FROM ontology_objects
          WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND merged_into IS NULL`,
        [orgId, userId],
      );
      const ownOtherObjects = !inPersonalThread ? { rows: [] as { id: string; name: string; aliases: string[] }[] } : await s.query<{ id: string; name: string; aliases: string[] }>(
        `SELECT o.id, o.name, o.aliases FROM ontology_objects o
           JOIN chat_threads t ON t.org_id = o.org_id AND t.id = o.scope_id
          WHERE o.org_id = $1 AND o.scope_kind = 'chat_session' AND o.scope_id <> $2 AND o.merged_into IS NULL
            AND t.project_id IS NULL AND t.created_by = $3 AND NOT t.archived`,
        [orgId, threadId, userId],
      );
      const toClaim = (scope: RecallClaim["scope"]) => (c: Row & { thread_id?: string }): RecallClaim[] => {
        const tri = KG.claimTriState(c.status as Parameters<typeof KG.claimTriState>[0]);
        return tri === null ? [] : [{
          id: c.id, statement: c.statement, kind: c.claim_kind ?? "fact", triState: tri, saidAt: c.said_at?.toISOString() ?? null, scope,
          ...(c.thread_id === undefined ? {} : { originThreadId: c.thread_id }),
        }];
      };
      const out: { claims: RecallClaim[]; objects: RecallObject[] } = {
        claims: [
          ...session.rows.flatMap(toClaim("chat_session")), ...personal.rows.flatMap(toClaim("personal")), ...ownOther.rows.flatMap(toClaim("personal")),
        ],
        objects: [...objects.rows, ...personalObjects.rows, ...ownOtherObjects.rows].map((o) => ({ id: o.id, name: o.name, aliases: o.aliases })),
      };
      return out;
    });
  }

  async graphNeighbors(orgId: OrgId, seedKeys: readonly string[]): Promise<readonly GraphHit[]> {
    // 每轮对话同步走一次变长遍历：给它一个上限，超时即按「图路不可用」降级（调用方已处理），不拖住回答。
    const r = await this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('statement_timeout', '2000', true)");
      return s.query<{
        seed_key: string; rel1: string; mid1_key: string | null; rel2: string | null; mid2_key: string | null; rel3: string | null; claim_key: string;
      }>("SELECT * FROM kg_graph_neighbors($1::text[])", [seedKeys]);
    });
    return r.rows.map((row) => {
      const nodes = [row.seed_key, row.mid1_key, row.mid2_key, row.claim_key].filter((x): x is string => x !== null);
      const rels = [row.rel1, row.rel2, row.rel3].filter((x): x is string => x !== null);
      const path: GraphHop[] = rels.map((relation, i) => ({ src: nodes[i]!, relation, dst: nodes[i + 1]! }));
      return { claimId: stripKind(row.claim_key), path };
    });
  }

  /** F13：一个 run 一行，重试覆盖。只写本 run 自己的 id（调用方是执行器，run 已受理）。 */
  async recordTurn(orgId: OrgId, record: TurnRecallRecord): Promise<void> {
    await this.db.withTenant(orgId, (s) => s.query(
      `INSERT INTO kg_turn_recalls (run_id, org_id, thread_id, requester_user_id, items, graph_degraded)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (run_id) DO UPDATE SET items = EXCLUDED.items, graph_degraded = EXCLUDED.graph_degraded, created_at = now()`,
      [record.runId, orgId, record.threadId, record.userId, JSON.stringify(record.items), record.graphDegraded],
    ));
  }
}
