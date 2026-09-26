/**
 * issue #4178 —— `KgOrgExtractionSettingsPort` 的 Postgres 实现。
 *
 * 只碰一张租户表（`kg_org_extraction_settings`），全部经 `withTenant`（RLS 第一道）。
 * 不经 `guard()`：这张表背后没有 `ObjectRef` 能表达的 ACL 对象，是组织配置元数据，
 * 不是要按内容披露的租户数据——同 `pg-tool-permission-grant-repository.ts` 的
 * `listStanding`/`revokeStanding`（#3068）一样，真正的裁决在应用层（`knowledge-graph.controller.ts`
 * 的 `requireOrgAdmin`），这一点由 `lint-permission-paths.mjs` 的豁免条目与
 * `tests/knowledge-graph/org-extraction-settings-repo-guard.test.ts` 一起钉住。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgOrgExtractionSettingsPort } from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";

export class PgKgOrgExtractionSettings implements KgOrgExtractionSettingsPort {
  constructor(private readonly db: DatabasePort) {}

  async getEnabled(orgId: OrgId): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ enabled: boolean }>(
        "SELECT enabled FROM kg_org_extraction_settings WHERE org_id = $1", [orgId],
      );
      // 没有行 = 从未设置过 = 默认关（新组织不默认抽取对话内容）。
      return r.rows[0]?.enabled ?? false;
    });
  }

  async setEnabled(orgId: OrgId, enabled: boolean, updatedByUserId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ enabled: boolean }>(
        `INSERT INTO kg_org_extraction_settings (org_id, enabled, updated_at, updated_by)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (org_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
         RETURNING enabled`,
        [orgId, enabled, updatedByUserId],
      );
      // INSERT ... ON CONFLICT DO UPDATE ... RETURNING 总有一行；没有行说明写没发生，
      // 回一个和调用方期望相反的假象比抛错更糟——这里直接让调用方看到写确实没落地。
      const row = r.rows[0];
      if (row === undefined) throw new Error("kg_org_extraction_settings upsert returned no row");
      return row.enabled;
    });
  }
}
