/**
 * `SubmitChangeRequestRepository` 的 PostgreSQL 实现（F29 补实现 / #1667）——
 * `templates.submitBlueprintChangeRequest` 首次接上电的写路径。
 *
 * 只有一个方法（同端口头注「端口的方法签名里没有任何能触及蓝本表或蓝本版本表的
 * 入参」），本文件的 SQL 与那句话逐字对应：唯一一条语句是 `INSERT INTO
 * blueprint_pending_changes`，不 JOIN、不 UPDATE 任何 `blueprints`/`blueprint_versions` 行。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { PendingChangeRecord } from "../../domain/templates/pending-change";
import type { SubmitChangeRequestRepository } from "../../application/templates/submit-change-request-ports";

export class PgSubmitChangeRequestRepository implements SubmitChangeRequestRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(orgId: OrgId, records: readonly PendingChangeRecord[]): Promise<readonly PendingChangeRecord[]> {
    if (records.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      for (const r of records) {
        await s.query(
          `INSERT INTO blueprint_pending_changes
             (id, org_id, blueprint_id, design_facet_key, before_value, after_value,
              source_project_id, proposed_by, proposed_at, rationale, base_version_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
          [
            r.changeRequestId,
            orgId,
            r.blueprintId,
            r.designFacetKey,
            r.beforeValue,
            r.afterValue,
            r.sourceProjectId,
            r.proposedBy,
            r.proposedAt,
            r.rationale,
            r.baseVersionId,
          ],
        );
      }
      return records;
    });
  }
}
