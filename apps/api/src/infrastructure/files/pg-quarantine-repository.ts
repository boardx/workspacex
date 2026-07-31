/**
 * PostgreSQL implementation of `QuarantineRepository` (F35, migration
 * `20260801000000_f35_upload_security.sql`).
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { NewQuarantineRecord, QuarantineRepository } from "../../application/files/upload-ports";

export class PgQuarantineRepository implements QuarantineRepository {
  constructor(private readonly db: DatabasePort) {}

  async record(entry: NewQuarantineRecord): Promise<void> {
    await this.db.withTenant(entry.orgId, (s) =>
      s.query(
        `INSERT INTO malware_quarantine_records
           (org_id, project_id, filename, content_hash, scan_verdict, uploaded_by, alerted)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          entry.orgId, entry.projectId, entry.filename, entry.contentHash, entry.scanVerdict,
          entry.uploadedBy, entry.alerted,
        ],
      ),
    );
  }
}
