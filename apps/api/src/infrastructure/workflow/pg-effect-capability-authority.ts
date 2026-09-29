/**
 * WF04 —— `EffectCapabilityAuthorityPort` 的 PostgreSQL 适配器（workflow_capability_grants）。
 * 没有配置行 = 组织管理员从未就该分类做过决定 → **保守判**，默认只读（`read` 封顶 + 已授权），不继承
 * 写权限（ADR-120 决策 #2：「实际授权由组织管理员给，默认只读，不继承写权限」；requirements 02 号
 * 文件 R10「capabilityCategory 缺失时按 MCP sideEffect 封顶保守判」同一立场）。新能力分类因此既不会
 * 被误判 blocked（read 类调用仍放行），也不会在没人配置时就拿到 `write`/`external_send`。
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
      if (!row) return { authorized: true, sideEffectCap: "read" };
      return { authorized: row.authorized, sideEffectCap: row.side_effect_cap };
    });
  }
}
