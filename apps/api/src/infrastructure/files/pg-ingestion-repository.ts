/**
 * PostgreSQL implementation of the F36 outbox/history ports.
 *
 * Every method runs through `withTenant`, same as `PgArtifactRepository` -- RLS is the first
 * line, `org_id` predicates the second. `claimNext` and `completeAndAdvance` are each ONE
 * `withTenant` call, i.e. one transaction, so `SELECT ... FOR UPDATE SKIP LOCKED` + the
 * claiming `UPDATE`, or the advance-and-requeue sequence, cannot be observed half-done by
 * another worker.
 *
 * ⚠ There is deliberately no cross-tenant "claim from any org" query. `ingestion_outbox` has
 * RLS FORCEd (this migration's own policy), and a query without a tenant context set would
 * not error -- it would silently see zero rows, the exact "fail closed = looks like no
 * data" trap `database.port.ts`'s own header warns about for `withoutTenant`. Making that
 * work would mean a SECURITY DEFINER function that bypasses RLS on this table, which is the
 * one thing `0023-f31-files-browser.sql`'s `wsx_visible_artifacts()` refuses to do for
 * exactly this reason (`artifacts-list-rls.test.ts` asserts it stays `SECURITY INVOKER`).
 * A process servicing many orgs calls `claimNext` once per known `orgId` on its poll tick.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { IngestionStatus } from "../../domain/files/ingestion-pipeline";
import type {
  IngestionHistoryRepository,
  IngestionOutboxJob,
  IngestionOutboxRepository,
  IngestionStep,
  NewIngestionOutboxJob,
} from "../../application/files/ingestion-ports";

export class PgIngestionRepository implements IngestionOutboxRepository, IngestionHistoryRepository {
  constructor(private readonly db: DatabasePort) {}

  async enqueue(job: NewIngestionOutboxJob): Promise<void> {
    await this.db.withTenant(job.orgId, (s) =>
      s.query(
        `INSERT INTO ingestion_outbox (org_id, artifact_id, artifact_version_id, step)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ON CONSTRAINT ingestion_outbox_uniq_active DO NOTHING`,
        [job.orgId, job.artifactId, job.artifactVersionId, job.step],
      ),
    );
  }

  async claimNext(orgId: OrgId, workerId: string, staleAfterMs: number): Promise<IngestionOutboxJob | null> {
    return this.db.withTenant(orgId, async (s) => {
      const claimed = await s.query<{
        id: string; org_id: string; artifact_id: string; artifact_version_id: string;
        step: string; attempts: number;
      }>(
        `UPDATE ingestion_outbox
            SET status = 'processing', locked_by = $2, locked_at = now(), attempts = attempts + 1
          WHERE org_id = $1
            AND id = (
              SELECT id FROM ingestion_outbox
               WHERE org_id = $1
                 AND (status = 'pending'
                      OR (status IN ('processing', 'failed')
                          AND locked_at < now() - ($3 || ' milliseconds')::interval))
               ORDER BY created_at
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
          RETURNING id::text, org_id, artifact_id, artifact_version_id, step, attempts`,
        [orgId, workerId, staleAfterMs],
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        orgId: row.org_id as OrgId,
        artifactId: row.artifact_id,
        artifactVersionId: row.artifact_version_id,
        step: row.step as IngestionStep,
        attempts: row.attempts,
      };
    });
  }

  async claimForVersion(
    orgId: OrgId,
    artifactVersionId: string,
    workerId: string,
  ): Promise<IngestionOutboxJob | null> {
    return this.db.withTenant(orgId, async (s) => {
      const claimed = await s.query<{
        id: string; org_id: string; artifact_id: string; artifact_version_id: string;
        step: string; attempts: number;
      }>(
        `UPDATE ingestion_outbox
            SET status = 'processing', locked_by = $3, locked_at = now(), attempts = attempts + 1
          WHERE org_id = $1
            AND id = (
              SELECT id FROM ingestion_outbox
               WHERE org_id = $1 AND artifact_version_id = $2
               FOR UPDATE SKIP LOCKED
            )
          RETURNING id::text, org_id, artifact_id, artifact_version_id, step, attempts`,
        [orgId, artifactVersionId, workerId],
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        orgId: row.org_id as OrgId,
        artifactId: row.artifact_id,
        artifactVersionId: row.artifact_version_id,
        step: row.step as IngestionStep,
        attempts: row.attempts,
      };
    });
  }

  async completeAndAdvance(
    orgId: OrgId,
    jobId: string,
    nextStatus: IngestionStatus,
    nextStep: IngestionStep | null,
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      const jobRows = await s.query<{ artifact_id: string; artifact_version_id: string }>(
        `SELECT artifact_id, artifact_version_id FROM ingestion_outbox WHERE org_id = $1 AND id = $2`,
        [orgId, jobId],
      );
      const job = jobRows.rows[0];
      // The job was already completed by another (or a since-replayed) worker and its row
      // is gone -- not an error, this IS what makes a second completion of the same step
      // harmless rather than a crash.
      if (job === undefined) return;

      await s.query(`UPDATE artifacts SET ingestion_status = $1 WHERE org_id = $2 AND id = $3`, [
        nextStatus,
        orgId,
        job.artifact_id,
      ]);
      await s.query(
        `INSERT INTO ingestion_history (org_id, artifact_version_id, status) VALUES ($1,$2,$3)`,
        [orgId, job.artifact_version_id, nextStatus],
      );
      await s.query(`DELETE FROM ingestion_outbox WHERE org_id = $1 AND id = $2`, [orgId, jobId]);
      if (nextStep !== null) {
        await s.query(
          `INSERT INTO ingestion_outbox (org_id, artifact_id, artifact_version_id, step)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT ON CONSTRAINT ingestion_outbox_uniq_active DO NOTHING`,
          [orgId, job.artifact_id, job.artifact_version_id, nextStep],
        );
      }
    });
  }

  async markFailed(orgId: OrgId, jobId: string, error: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE ingestion_outbox SET status = 'failed', last_error = $3 WHERE org_id = $1 AND id = $2`,
        [orgId, jobId, error],
      ),
    );
  }

  async findByVersion(orgId: OrgId, artifactVersionId: string): Promise<IngestionOutboxJob | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; org_id: string; artifact_id: string; artifact_version_id: string;
        step: string; attempts: number;
      }>(
        `SELECT id::text, org_id, artifact_id, artifact_version_id, step, attempts
           FROM ingestion_outbox WHERE org_id = $1 AND artifact_version_id = $2`,
        [orgId, artifactVersionId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        orgId: row.org_id as OrgId,
        artifactId: row.artifact_id,
        artifactVersionId: row.artifact_version_id,
        step: row.step as IngestionStep,
        attempts: row.attempts,
      };
    });
  }

  async history(orgId: OrgId, artifactVersionId: string): Promise<readonly IngestionStatus[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ status: string }>(
        `SELECT status FROM ingestion_history
          WHERE org_id = $1 AND artifact_version_id = $2
          ORDER BY occurred_at`,
        [orgId, artifactVersionId],
      );
      return r.rows.map((row) => row.status as IngestionStatus);
    });
  }
}
