/**
 * PostgreSQL implementation of F46's `PhysicalDeleteTaskRepository` / `DeletionReceiptRepository`.
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  DeletionReceiptRepository,
  FindTaskForPurgeRow,
  PhysicalDeleteTaskRepository,
  PurgeableObject,
} from "../../application/files/physical-delete-ports";
import type { DeletionReceipt } from "../../domain/files/physical-delete";
import type { OrgId } from "../../domain/org-id";

/** Every version's object + every derived representation under any of those versions. */
async function purgeableObjectsFor(
  s: TenantSession,
  orgId: OrgId,
  artifactId: string,
): Promise<readonly PurgeableObject[]> {
  const versions = await s.query<{ id: string; object_storage_key: string; content_hash: string }>(
    `SELECT id, object_storage_key, content_hash FROM artifact_versions WHERE org_id = $1 AND artifact_id = $2`,
    [orgId, artifactId],
  );
  const versionIds = versions.rows.map((r) => r.id);
  const versionObjects: PurgeableObject[] = versions.rows.map((r) => ({
    objectKey: r.object_storage_key,
    sha256: r.content_hash,
  }));

  // `object_storage_key IS NOT NULL`: `embedding`-kind derived rows are registered but have
  // no downloadable file (0006/F44's own nullable column + CHECK) -- nothing to purge for
  // those, and including a NULL key would ask `PhysicalPurgePort.purgeAll` to delete "".
  const derived = versionIds.length === 0
    ? { rows: [] as { object_storage_key: string }[] }
    : await s.query<{ object_storage_key: string }>(
        `SELECT object_storage_key FROM derived_representations
          WHERE org_id = $1 AND derived_from = ANY($2::text[]) AND object_storage_key IS NOT NULL`,
        [orgId, versionIds],
      );
  // `derived_representations` has no hash column (0006's own schema) -- purged, but
  // contributes nothing to the receipt's `hashes` array (see `PurgeableObject.sha256`'s doc).
  const derivedObjects: PurgeableObject[] = derived.rows.map((r) => ({ objectKey: r.object_storage_key, sha256: null }));

  return [...versionObjects, ...derivedObjects];
}

export class PgPhysicalDeleteTaskRepository implements PhysicalDeleteTaskRepository {
  constructor(private readonly db: DatabasePort) {}

  async listPendingPhysicalDeletion(orgId: OrgId, now: Date): Promise<readonly FindTaskForPurgeRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      // 🔴 N-17: only `'running'` tasks are candidates -- a `'partial-failure'` task must
      // never reach the object store (see `domain/files/physical-delete.ts`'s own gate,
      // re-checked there too; this WHERE clause is the first line of defense, not the only
      // one). `receipt_id IS NULL` excludes tasks already done (idempotent re-runs of a
      // sweep must not re-purge or re-issue a second receipt).
      const tasks = await s.query<{
        id: string; artifact_id: string; status: FindTaskForPurgeRow["status"];
        physical_deletion_deadline: Date; receipt_id: string | null;
      }>(
        `SELECT id, artifact_id, status, physical_deletion_deadline, receipt_id
           FROM deletion_tasks
          WHERE org_id = $1 AND status = 'running' AND receipt_id IS NULL
            AND physical_deletion_deadline <= $2`,
        [orgId, now],
      );

      const rows: FindTaskForPurgeRow[] = [];
      for (const t of tasks.rows) {
        const objects = await purgeableObjectsFor(s, orgId, t.artifact_id);
        rows.push({
          taskId: t.id,
          artifactId: t.artifact_id,
          status: t.status,
          physicalDeletionDeadline: t.physical_deletion_deadline,
          receiptId: t.receipt_id,
          objects,
        });
      }
      return rows;
    });
  }

  async markPhysicallyDeleted(orgId: OrgId, taskId: string, receiptId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE deletion_tasks SET status = 'done', receipt_id = $3 WHERE org_id = $1 AND id = $2`,
        [orgId, taskId, receiptId],
      );
    });
  }
}

export class PgDeletionReceiptRepository implements DeletionReceiptRepository {
  constructor(private readonly db: DatabasePort) {}

  async save(orgId: OrgId, receipt: DeletionReceipt): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO deletion_receipts
           (task_id, org_id, object_refs, hashes, deleted_at, executor, uncoverable_statement, exported_out_of_org)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (task_id) DO NOTHING`,
        [
          receipt.taskId, orgId, receipt.objectRefs, receipt.hashes, receipt.deletedAt,
          receipt.executor, receipt.uncoverableStatement, JSON.stringify(receipt.exportedOutOfOrg),
        ],
      );
    });
  }

  async find(orgId: OrgId, taskId: string): Promise<DeletionReceipt | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        task_id: string; object_refs: string[]; hashes: string[]; deleted_at: Date;
        executor: string; uncoverable_statement: string; exported_out_of_org: unknown;
      }>(
        `SELECT task_id, object_refs, hashes, deleted_at, executor, uncoverable_statement, exported_out_of_org
           FROM deletion_receipts WHERE org_id = $1 AND task_id = $2`,
        [orgId, taskId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        taskId: row.task_id,
        objectRefs: row.object_refs,
        hashes: row.hashes,
        deletedAt: row.deleted_at.toISOString(),
        executor: row.executor,
        // Not persisted here (see `physical-delete-ports.ts`'s `DeletionReceiptRepository`
        // header) -- `get-deletion-receipt.ts` joins the real value in from F45's
        // `deletion_cascade_results` before returning to the contract.
        coverage: [],
        exportedOutOfOrg: row.exported_out_of_org as DeletionReceipt["exportedOutOfOrg"],
        uncoverableStatement: row.uncoverable_statement,
      };
    });
  }
}
