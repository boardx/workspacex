/**
 * `ProjectNameLookupPort` 的 PostgreSQL 实现（#728 D4）。
 *
 * 同 `pg-project-tags-repository.ts` 的形状：一条 `SELECT`，`withTenant` 顺带确认
 * `projectId` 属于这个组织（RLS + 复合主键 `(id, org_id)` 双重保证，不会跨租户读错行）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ProjectNameLookupPort } from "../../application/project/ports";
import type { OrgId } from "../../domain/org-id";

export class PgProjectNameLookup implements ProjectNameLookupPort {
  constructor(private readonly db: DatabasePort) {}

  async findName(orgId: OrgId, projectId: string): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<{ name: string }>(
        `SELECT name FROM projects WHERE id = $1 AND org_id = $2`,
        [projectId, orgId],
      );
      return found.rows[0]?.name ?? null;
    });
  }
}
