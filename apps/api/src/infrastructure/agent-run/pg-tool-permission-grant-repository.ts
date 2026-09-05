/**
 * PostgreSQL implementation of `ToolPermissionGrantStore`（Phase 14 F06，`plan-permissions`
 * 契约束 R5）—— 三档授权粒度里需要持久化的两档："本次 run 内都允许"与"以后都允许"。
 * "单次"不落库，见端口自己的文档。
 *
 * 存储在 `tool_permission_grants`（迁移 `20260905120000_f06_tool_permission_tiering.sql`），
 * 一张表两种 scope：`run`（`run_id` 非空，只在该 run 生命周期内被查询）与 `forever`
 * （`run_id` 为空，组织级、跨 run 生效，无过期）。RLS 按 `org_id` 隔离，与本仓其余
 * 租户表同一条纪律。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ToolPermissionGrantStore } from "../../application/agent-run/tool-permission-grants";

export class PgToolPermissionGrantRepository implements ToolPermissionGrantStore {
  constructor(private readonly db: DatabasePort) {}

  async hasGrant(orgId: OrgId, runId: string, toolName: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM tool_permission_grants
           WHERE org_id = $1 AND tool_name = $2
             AND (scope = 'forever' OR (scope = 'run' AND run_id = $3))
         ) AS exists`,
        [orgId, toolName, runId],
      );
      return result.rows[0]?.exists ?? false;
    });
  }

  async grantForRun(orgId: OrgId, runId: string, toolName: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO tool_permission_grants (id, org_id, scope, run_id, tool_name, granted_by_user_id, granted_at)
         VALUES ($1, $2, 'run', $3, $4, NULL, now())
         ON CONFLICT (org_id, run_id, tool_name) WHERE scope = 'run' DO NOTHING`,
        [randomUUID(), orgId, runId, toolName],
      );
    });
  }

  async grantStanding(orgId: OrgId, toolName: string, grantedByUserId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO tool_permission_grants (id, org_id, scope, run_id, tool_name, granted_by_user_id, granted_at)
         VALUES ($1, $2, 'forever', NULL, $3, $4, now())
         ON CONFLICT (org_id, tool_name) WHERE scope = 'forever' DO NOTHING`,
        [randomUUID(), orgId, toolName, grantedByUserId],
      );
    });
  }
}
