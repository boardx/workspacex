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
import type { StandingGrantRow, ToolPermissionGrantStore } from "../../application/agent-run/tool-permission-grants";

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

  /** Phase 14 F11（R4 E3）—— 见端口自己的文档："本 run 内都允许"整体失效，不逐工具名撤销。 */
  async revokeAllForRun(orgId: OrgId, runId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `DELETE FROM tool_permission_grants WHERE org_id = $1 AND scope = 'run' AND run_id = $2`,
        [orgId, runId],
      );
    });
  }

  /**
   * issue #3068 —— 组织级授权清单。这是本文件**唯一**一条把行内容交还给调用方的读
   * （`hasGrant` 仍然只折成布尔），所以它的裁决在上一层：
   * `tool-permission-grant.controller.ts` 的 `requireOrgAdmin`——与
   * `pg-model-pool-repository.ts` 的 `listForOrg` 同一形状、同一条豁免理由
   * （`tool_permission_grants` 不是 `ObjectRef` 的任何一种，硬塞进 `guard()` 会退化成
   * DEFAULT_SCOPE 组织级、对每个成员返回 allowed=true，那比没有裁决更糟）。
   * 返回列刻意不含 `run_id`/`scope`：只有 `forever` 一档会出现在这里。
   */
  async listStanding(orgId: OrgId): Promise<readonly StandingGrantRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ id: string; tool_name: string; by: string | null; at: Date | string }>(
        `SELECT id, tool_name, granted_by_user_id AS by, granted_at AS at
           FROM tool_permission_grants
          WHERE org_id = $1 AND scope = 'forever'
          ORDER BY granted_at DESC, id`,
        [orgId],
      );
      return result.rows.map((row) => ({
        grantId: row.id,
        toolName: row.tool_name,
        grantedByUserId: row.by,
        grantedAt: row.at instanceof Date ? row.at.toISOString() : String(row.at),
      }));
    });
  }

  /**
   * issue #3068 —— 撤销一条组织级授权。
   *
   * `DELETE … WHERE scope='forever'` 里的 `scope` 谓词不是装饰：没有它，一个
   * `run` 档的行 id 也能从这条路径被删掉，等于给「本 run 内都允许」开了第二条
   * 与 `revokeAllForRun` 语义不同的撤销口。
   *
   * `RETURNING` + 一条 `tool_permission_revocations` 的 append-only 留痕在同一个
   * 事务里：F06 迁移末尾那条「授权记录是审计留痕」的纪律靠的是"不许删"，撤销路径
   * 落地后由这张表接住——谁在何时撤销了哪条、那条当初是谁批的，比"不许删"记得更多。
   */
  async revokeStanding(orgId: OrgId, grantId: string, revokedByUserId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const deleted = await s.query<{ tool_name: string; granted_by_user_id: string | null; granted_at: string }>(
        `DELETE FROM tool_permission_grants
          WHERE org_id = $1 AND id = $2 AND scope = 'forever'
        RETURNING tool_name, granted_by_user_id, granted_at`,
        [orgId, grantId],
      );
      const row = deleted.rows[0];
      // 并发下两个管理员点同一行：后一个什么也没删到，如实回 false，不补写留痕。
      if (!row) return false;
      await s.query(
        `INSERT INTO tool_permission_revocations
           (id, org_id, grant_id, tool_name, granted_by_user_id, granted_at, revoked_by_user_id, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [randomUUID(), orgId, grantId, row.tool_name, row.granted_by_user_id, row.granted_at, revokedByUserId],
      );
      return true;
    });
  }
}
