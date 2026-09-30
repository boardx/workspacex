/**
 * WF04 —— `EffectCapabilityAuthorityPort` 的 PostgreSQL 适配器（workflow_capability_grants）。
 * 没有配置行 = 组织管理员从未就该分类做过决定 → **保守判**，默认只读（`read` 封顶 + 已授权），不继承
 * 写权限（ADR-120 决策 #2：「实际授权由组织管理员给，默认只读，不继承写权限」；requirements 02 号
 * 文件 R10「capabilityCategory 缺失时按 MCP sideEffect 封顶保守判」同一立场）。新能力分类因此既不会
 * 被误判 blocked（read 类调用仍放行），也不会在没人配置时就拿到 `write`/`external_send`。
 *
 * 同文件的 `PgWorkflowCapabilityGrantStore` 是管理面写端（授予 / 撤销），只被
 * `application/workflow/workflow-capability-grants.ts` 经 DI 端口使用：admin 判定与审计在那一层，
 * 审计 `provenance_events` 由调用方传入的回调在**同一事务**里写（本文件不点名其它表）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AuditWithin, StoredCapabilityGrant, WorkflowCapabilityGrantStore } from "../../application/workflow/workflow-capability-grants";
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

interface GrantRow {
  capability_category: string;
  authorized: boolean;
  side_effect_cap: WorkflowSideEffectClass;
  updated_at: Date | string;
  updated_by: string | null;
}

const COLS = "capability_category, authorized, side_effect_cap, updated_at, updated_by";

function toStored(r: GrantRow): StoredCapabilityGrant {
  return {
    capabilityCategory: r.capability_category,
    authorized: r.authorized,
    sideEffectCap: r.side_effect_cap,
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedBy: r.updated_by,
  };
}

export class PgWorkflowCapabilityGrantStore implements WorkflowCapabilityGrantStore {
  constructor(private readonly db: DatabasePort) {}

  list(orgId: string): Promise<StoredCapabilityGrant[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<GrantRow>(
        `SELECT ${COLS} FROM workflow_capability_grants WHERE org_id = $1 ORDER BY capability_category`,
        [orgId],
      );
      return rows.map(toStored);
    });
  }

  upsert(orgId: string, capabilityCategory: string, sideEffectCap: WorkflowSideEffectClass, actorId: string, audit: AuditWithin): Promise<StoredCapabilityGrant> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const before = await this.lockOne(s, orgId, capabilityCategory);
      const { rows } = await s.query<GrantRow>(
        `INSERT INTO workflow_capability_grants (org_id, capability_category, authorized, side_effect_cap, updated_at, updated_by)
         VALUES ($1, $2, true, $3, now(), $4)
         ON CONFLICT (org_id, capability_category) DO UPDATE
           SET authorized = true, side_effect_cap = EXCLUDED.side_effect_cap, updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING ${COLS}`,
        [orgId, capabilityCategory, sideEffectCap, actorId],
      );
      await audit(s, before);
      return toStored(rows[0]!);
    });
  }

  remove(orgId: string, capabilityCategory: string, audit: AuditWithin): Promise<StoredCapabilityGrant | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const before = await this.lockOne(s, orgId, capabilityCategory);
      await s.query(`DELETE FROM workflow_capability_grants WHERE org_id = $1 AND capability_category = $2`, [orgId, capabilityCategory]);
      await audit(s, before);
      return before;
    });
  }

  private async lockOne(s: TenantSession, orgId: string, capabilityCategory: string): Promise<StoredCapabilityGrant | null> {
    const { rows } = await s.query<GrantRow>(
      `SELECT ${COLS} FROM workflow_capability_grants WHERE org_id = $1 AND capability_category = $2 FOR UPDATE`,
      [orgId, capabilityCategory],
    );
    return rows[0] ? toStored(rows[0]) : null;
  }
}
