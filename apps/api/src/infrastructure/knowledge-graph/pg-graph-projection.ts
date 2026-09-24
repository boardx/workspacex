/**
 * `GraphProjectionPort` 的 Postgres 实现：两个 SECURITY DEFINER 函数的薄封装（迁移 20260924200000）。
 * app_rw 碰不到图 schema；它能做的只有「让数据库按 canonical 的当前状态投影本 org」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { GraphProjectionPort } from "../../application/knowledge-graph/ports";
import { toOrgId, type OrgId } from "../../domain/org-id";

export class PgGraphProjection implements GraphProjectionPort {
  constructor(private readonly db: DatabasePort) {}

  async pendingOrgs(): Promise<readonly OrgId[]> {
    // 只读 org id（函数不返回任何内容）；每个 org 的实际投影仍在它自己的 withTenant 里做。
    const r = await this.db.withoutTenant((s) => s.query<{ org: string }>("SELECT kg_projection_pending_orgs() AS org"));
    return r.rows.map((x) => toOrgId(x.org));
  }

  async projectPending(orgId: OrgId, limit: number): Promise<number> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ n: number }>("SELECT kg_project_pending($1) AS n", [limit]));
    return Number(r.rows[0]!.n);
  }

  async deadCount(): Promise<number> {
    const r = await this.db.withoutTenant((s) => s.query<{ n: string }>("SELECT kg_projection_dead_count()::text AS n"));
    return Number(r.rows[0]!.n);
  }
}
