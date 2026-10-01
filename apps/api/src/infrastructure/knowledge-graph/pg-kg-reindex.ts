/**
 * UC-KG-4 requestReindex（issue #4352）的 Postgres 实现：只调用 SECURITY DEFINER 函数
 * `kg_extraction_requeue_thread`（迁移 20260928160000）——队列只经触发器 / 这个函数写入，app_rw 没有 INSERT 权限。
 * 租户由 withTenant 设定（函数取 `app.current_org`，不接受参数传入的 org）。不读任何正文，只回一个条数。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgReindexPort } from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";
import { KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS } from "./pg-kg-extraction";

export class PgKgReindex implements KgReindexPort {
  constructor(private readonly db: DatabasePort) {}

  async requeueThread(orgId: OrgId, threadId: string, sourceRefs: readonly string[] | null): Promise<number | "already_running"> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ n: number }>(
      // 「还在整理中」的次数上限与 worker / 面板分桶同一个常量（不在 SQL 里另写一份）。
      "SELECT kg_extraction_requeue_thread($1, $2::text[], $3, $4) AS n",
      [threadId, sourceRefs === null ? null : [...sourceRefs], KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS],
    ));
    const n = r.rows[0]?.n ?? 0;
    return n < 0 ? "already_running" : n;
  }
}
