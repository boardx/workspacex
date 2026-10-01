/**
 * Phase 20 WS04 —— 读本组织「工具 × 能力分类 × 授权」快照（`org_tool_capability_grants`，RLS 按 org_id）。
 * 一次 `withTenant`，WHERE 仍显式带 org_id（第二道防线）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ToolGrantReader } from "../../application/skill/work-skill-readiness";
import type { OrgId } from "../../domain/org-id";
import type { OrgToolCapabilityGrant, ToolGrantState } from "../../domain/skill/work-skill-readiness";

export class PgToolGrantReader implements ToolGrantReader {
  constructor(private readonly db: DatabasePort) {}

  async listForOrg(orgId: OrgId): Promise<readonly OrgToolCapabilityGrant[]> {
    return this.db.withTenant(orgId, async (session) => {
      const { rows } = await session.query<{ category: string; tool_ref: string; enabled: boolean; grant_state: ToolGrantState }>(
        `SELECT category, tool_ref, enabled, grant_state FROM org_tool_capability_grants WHERE org_id = $1`,
        [orgId],
      );
      return rows.map((r) => ({ category: r.category, toolRef: r.tool_ref, enabled: r.enabled, grant: r.grant_state }));
    });
  }
}
