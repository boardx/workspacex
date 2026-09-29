/**
 * CT06 —— `SkillVersionResolverPort` 的 PostgreSQL 适配器：按 Skill 稳定 ID（S0xx）+ 固定版本在**本组织**
 * Work Skill 目录里解析（ADR-118 #9；契约束 work-skill-meta SkillCatalogEntry）。
 *
 * 判据：目录行存在且通道不是 deprecated，且该 Skill 有 `semantic_label` 恰为请求版本的 **published**
 * `skill_versions` 行。门状态（G0–G2）在 pack 构建 / 导入时已机械门控（UC-WC-I1 E1：引用未 PASS 的实体
 * 不产出 pack），所以能进本组织目录的版本即已过门。解析不到 → null（start 诚实地得到 skill_version_unresolved）。
 *
 * 只返回版本号，不返回任何 Skill 内容。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { SkillVersionResolverPort } from "../../application/workflow/workflow-ports";
import { toOrgId } from "../../domain/org-id";

export class PgSkillCatalogVersionResolver implements SkillVersionResolverPort {
  constructor(private readonly db: DatabasePort) {}

  resolve(orgId: string, stableId: string, versionRange: string): Promise<string | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ semantic_label: string }>(
        `SELECT sv.semantic_label
           FROM skill_catalog_entries e
           JOIN skill_versions sv ON sv.skill_id = e.skill_id AND sv.org_id = e.org_id AND sv.published
          WHERE e.org_id = $1 AND e.stable_id = $2 AND e.channel <> 'deprecated' AND sv.semantic_label = $3
          LIMIT 1`,
        [orgId, stableId, versionRange],
      );
      return rows[0]?.semantic_label ?? null;
    });
  }
}
