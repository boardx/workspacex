/**
 * WF04 —— `EffectCapabilityAuthorityPort` 的 PostgreSQL 适配器（workflow_capability_grants）。
 * 没有配置行 = 未收紧，默认放行（`external_send` 封顶 + 已授权）——新能力分类不因漏配置被误判阻断。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { WorkflowSideEffectClass } from "../../application/workflow/effect-gateway";
import type { CapabilityAuthorityCheck, EffectCapabilityAuthorityPort } from "../../application/workflow/effect-permission-recheck";
import { toOrgId } from "../../domain/org-id";

export class PgEffectCapabilityAuthority implements EffectCapabilityAuthorityPort {
  constructor(private readonly db: DatabasePort) {}

  checkCapability(orgId: string, capabilityCategory: string): Promise<CapabilityAuthorityCheck> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ authorized: boolean; side_effect_cap: WorkflowSideEffectClass }>(
        `SELECT authorized, side_effect_cap FROM workflow_capability_grants WHERE org_id = $1 AND capability_category = $2`,
        [orgId, capabilityCategory],
      );
      const row = rows[0];
      if (!row) return { authorized: true, sideEffectCap: "external_send" };
      return { authorized: row.authorized, sideEffectCap: row.side_effect_cap };
    });
  }
}
