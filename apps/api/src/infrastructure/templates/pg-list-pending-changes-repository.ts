/**
 * `ListPendingChangesRepository` 的 PostgreSQL 实现（F29 补实现 / #1667）。
 * 纯读，只碰 `blueprint_pending_changes` 一张表，按 `blueprint_id` 过滤。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { PendingChangeRecord, PendingChangeStatus } from "../../domain/templates/pending-change";
import type { ListPendingChangesRepository } from "../../application/templates/list-pending-changes-ports";

interface Row {
  id: string;
  blueprint_id: string;
  design_facet_key: string;
  before_value: string;
  after_value: string;
  source_project_id: string;
  proposed_by: string;
  proposed_at: string;
  rationale: string;
  base_version_id: string;
  status: PendingChangeStatus;
}

export class PgListPendingChangesRepository implements ListPendingChangesRepository {
  constructor(private readonly db: DatabasePort) {}

  async list(orgId: OrgId, blueprintId: string): Promise<readonly PendingChangeRecord[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT id, blueprint_id, design_facet_key, before_value, after_value,
                source_project_id, proposed_by, proposed_at, rationale, base_version_id, status
           FROM blueprint_pending_changes
          WHERE blueprint_id = $1
          ORDER BY created_at ASC`,
        [blueprintId],
      );
      return r.rows.map((row) => ({
        changeRequestId: row.id,
        blueprintId: row.blueprint_id,
        designFacetKey: row.design_facet_key,
        beforeValue: row.before_value,
        afterValue: row.after_value,
        sourceProjectId: row.source_project_id,
        proposedBy: row.proposed_by,
        proposedAt: row.proposed_at,
        rationale: row.rationale,
        baseVersionId: row.base_version_id,
        status: row.status,
      }));
    });
  }
}
