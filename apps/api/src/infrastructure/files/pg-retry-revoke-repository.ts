/**
 * PostgreSQL implementations of F46's `RetryCascadeRepository` and `RevokeDeletionRepository`
 * -- both small mutations against F45's existing `deletion_tasks`/`deletion_cascade_results`/
 * `artifacts` tables, kept in one file since neither is large enough to earn its own.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { RetryCascadeRepository } from "../../application/files/retry-cascade-ports";
import type { RevokeDeletionRepository } from "../../application/files/revoke-deletion-ports";
import type { CascadeResultEntry } from "../../domain/files/deletion-cascade";
import type { OrgId } from "../../domain/org-id";

export class PgRetryCascadeRepository implements RetryCascadeRepository {
  constructor(private readonly db: DatabasePort) {}

  async updateCascadeResults(orgId: OrgId, taskId: string, results: readonly CascadeResultEntry[]): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      for (const r of results) {
        await s.query(
          `INSERT INTO deletion_cascade_results (task_id, org_id, kind, result, detail, checked_at)
           VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (task_id, kind) DO UPDATE SET
             result = excluded.result, detail = excluded.detail, checked_at = excluded.checked_at`,
          [taskId, orgId, r.kind, r.result, r.detail],
        );
      }
    });
  }

  async updateStatus(orgId: OrgId, taskId: string, status: "running" | "partial-failure"): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(`UPDATE deletion_tasks SET status = $3 WHERE org_id = $1 AND id = $2`, [orgId, taskId, status]);
    });
  }
}

export class PgRevokeDeletionRepository implements RevokeDeletionRepository {
  constructor(private readonly db: DatabasePort) {}

  async restoreArtifact(orgId: OrgId, artifactId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(`UPDATE artifacts SET deleted_at = NULL WHERE org_id = $1 AND id = $2`, [orgId, artifactId]);
    });
  }
}
