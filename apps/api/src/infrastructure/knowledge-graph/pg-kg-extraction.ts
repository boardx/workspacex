/**
 * Phase 18 F06 —— 抽取队列与抽取数据源的 Postgres 实现。全部在 withTenant 里，按 RLS 走。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  KgExtractionJob, KgExtractionQueuePort, KgExtractionSourcePort, KgMessage,
} from "../../application/knowledge-graph/ports";
import type { KnownObject } from "../../domain/knowledge-graph/extraction";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** 与迁移里 kg_extraction_pending_orgs 的 `attempts < 3` 是同一个上限。 */
export const KG_EXTRACTION_MAX_ATTEMPTS = 3;
/** 认领租约：worker 崩了，这么久之后别的 worker 可以接手。比一次模型调用的最长耗时宽裕。 */
export const KG_EXTRACTION_LEASE_SECONDS = 300;
/** 第一次失败后的退避秒数；之后每次 ×4。 */
export const KG_EXTRACTION_BACKOFF_SECONDS = 30;

export class PgKgExtraction implements KgExtractionQueuePort, KgExtractionSourcePort {
  constructor(private readonly db: DatabasePort) {}

  async pendingOrgs(): Promise<readonly OrgId[]> {
    const r = await this.db.withoutTenant((s) => s.query<{ org: string }>("SELECT kg_extraction_pending_orgs() AS org"));
    return r.rows.map((x) => toOrgId(x.org));
  }

  async enable(): Promise<void> {
    await this.db.withoutTenant((s) => s.query("SELECT kg_extraction_enable()"));
  }

  async claim(orgId: OrgId, limit: number): Promise<readonly KgExtractionJob[]> {
    // MATERIALIZED：`UPDATE … WHERE id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)` 在统计信息说队列很小时
    // 会被规划成嵌套循环、把带 LIMIT 的子查询每行重跑一遍——一次「认领 5 条」实测认领走了整个积压。
    // 物化的 CTE 只执行一次，认领数严格 ≤ limit。
    const r = await this.db.withTenant(orgId, (s) => s.query<{ message_id: string; thread_id: string; attempts: number }>(
      `WITH picked AS MATERIALIZED (
         SELECT message_id FROM kg_extraction_queue
          WHERE org_id = $1 AND attempts < $2 AND next_attempt_at <= now()
            AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => $3))
          ORDER BY enqueued_at LIMIT $4
          FOR UPDATE SKIP LOCKED)
       UPDATE kg_extraction_queue q SET locked_at = now(), attempts = q.attempts + 1
         FROM picked WHERE q.message_id = picked.message_id
       RETURNING q.message_id, q.thread_id, q.attempts`,
      [orgId, KG_EXTRACTION_MAX_ATTEMPTS, KG_EXTRACTION_LEASE_SECONDS, limit],
    ));
    return r.rows.map((x) => ({ orgId, messageId: x.message_id, threadId: x.thread_id, attempts: x.attempts }));
  }

  async complete(orgId: OrgId, messageId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) => s.query("DELETE FROM kg_extraction_queue WHERE org_id = $1 AND message_id = $2", [orgId, messageId]));
  }

  async fail(orgId: OrgId, messageId: string, error: string): Promise<void> {
    // 指数退避：30 秒、2 分钟、8 分钟——模型短暂不可用时，三次机会不会在连续三个轮询里一口气用光。
    await this.db.withTenant(orgId, (s) => s.query(
      `UPDATE kg_extraction_queue
          SET locked_at = NULL, last_error = left($3, 500),
              next_attempt_at = now() + make_interval(secs => $4 * power(4, greatest(attempts - 1, 0)))
        WHERE org_id = $1 AND message_id = $2`,
      [orgId, messageId, error, KG_EXTRACTION_BACKOFF_SECONDS],
    ));
  }

  async loadMessage(orgId: OrgId, messageId: string, contextTurns: number) {
    return this.db.withTenant(orgId, async (s) => {
      type Row = { id: string; thread_id: string; body: string; author_kind: "human" | "agent" };
      const m = await s.query<Row & { created_at: Date }>(
        "SELECT id, thread_id, body, author_kind, created_at FROM chat_messages WHERE org_id = $1 AND id = $2 AND visibility_scope IS NULL", [orgId, messageId],
      );
      const row = m.rows[0];
      if (row === undefined) return null;
      const ctx = await s.query<Row>(
        `SELECT id, thread_id, body, author_kind FROM chat_messages
          WHERE org_id = $1 AND thread_id = $2 AND raw_transcript = false AND visibility_scope IS NULL
            AND (created_at, id) < ($3, $4)
          ORDER BY created_at DESC, id DESC LIMIT $5`,
        [orgId, row.thread_id, row.created_at, row.id, contextTurns],
      );
      const toMsg = (x: Row): KgMessage => ({ id: x.id, threadId: x.thread_id, body: x.body, authorKind: x.author_kind });
      return { message: toMsg(row), context: ctx.rows.reverse().map(toMsg) };
    });
  }

  async knownObjects(orgId: OrgId, threadId: string): Promise<readonly KnownObject[]> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ id: string; name: string; aliases: string[]; object_kind: KnownObject["kind"] }>(
      `SELECT id, name, aliases, object_kind FROM ontology_objects
        WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND merged_into IS NULL
        ORDER BY created_at, id`,
      [orgId, threadId],
    ));
    return r.rows.map((x) => ({ id: x.id, name: x.name, aliases: x.aliases, kind: x.object_kind }));
  }
}
