/**
 * PostgreSQL implementation of F46's `TrashQueueRepository` -- lists `deletion_tasks` ids
 * for a project, optionally filtered by status.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { TrashQueueRepository, TrashQueueStatus } from "../../application/files/trash-queue-ports";
import type { OrgId } from "../../domain/org-id";

export class PgTrashQueueRepository implements TrashQueueRepository {
  constructor(private readonly db: DatabasePort) {}

  async listTaskIds(orgId: OrgId, projectId: string, status: TrashQueueStatus | null): Promise<readonly string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT dt.id
           FROM deletion_tasks dt
           JOIN artifacts a ON a.id = dt.artifact_id AND a.org_id = dt.org_id
          WHERE dt.org_id = $1 AND a.project_id = $2
            AND ($3::text IS NULL OR dt.status = $3)
          ORDER BY dt.requested_at DESC`,
        [orgId, projectId, status],
      );
      return r.rows.map((row) => row.id);
    });
  }
}
