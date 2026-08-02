/**
 * PostgreSQL implementation of F46's `RetentionPolicyRepository` (`retention_policies`,
 * migration `20260802000000_f46_trash_queue_legalhold_retention.sql`).
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { RetentionPolicyRepository } from "../../application/files/retention-policy-ports";
import type { PartialRetentionParams } from "../../domain/files/retention-policy";
import type { OrgId } from "../../domain/org-id";

interface RetentionRow {
  material_days: number | null;
  derived_days: number | null;
  log_days: number | null;
  trash_grace_days: number | null;
  backup_days: number | null;
}

function toPartial(row: RetentionRow): PartialRetentionParams {
  const out: PartialRetentionParams = {};
  if (row.material_days !== null) out.materialDays = row.material_days;
  if (row.derived_days !== null) out.derivedDays = row.derived_days;
  if (row.log_days !== null) out.logDays = row.log_days;
  if (row.trash_grace_days !== null) out.trashGraceDays = row.trash_grace_days;
  if (row.backup_days !== null) out.backupDays = row.backup_days;
  return out;
}

export class PgRetentionPolicyRepository implements RetentionPolicyRepository {
  constructor(private readonly db: DatabasePort) {}

  async getOverride(orgId: OrgId, projectId: string): Promise<PartialRetentionParams | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<RetentionRow>(
        `SELECT material_days, derived_days, log_days, trash_grace_days, backup_days
           FROM retention_policies WHERE org_id = $1 AND project_id = $2`,
        [orgId, projectId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toPartial(row);
    });
  }

  async setOverride(input: {
    orgId: OrgId;
    projectId: string;
    params: PartialRetentionParams;
    updatedBy: string;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO retention_policies
           (project_id, org_id, material_days, derived_days, log_days, trash_grace_days, backup_days, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (project_id) DO UPDATE SET
           material_days = excluded.material_days,
           derived_days = excluded.derived_days,
           log_days = excluded.log_days,
           trash_grace_days = excluded.trash_grace_days,
           backup_days = excluded.backup_days,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
        [
          input.projectId, input.orgId,
          input.params.materialDays ?? null,
          input.params.derivedDays ?? null,
          input.params.logDays ?? null,
          input.params.trashGraceDays ?? null,
          input.params.backupDays ?? null,
          input.updatedBy,
        ],
      );
    });
  }
}
