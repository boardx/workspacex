/**
 * PostgreSQL implementation of F46's `LegalHoldWriteRepository` (write-side of `legal_holds`,
 * the table F45 already created and reads from via `PgLegalHoldGate`).
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { LegalHoldWriteRepository } from "../../application/files/legal-hold-ports";
import type { ActiveHold } from "../../domain/files/legal-hold";
import type { OrgId } from "../../domain/org-id";

export class PgLegalHoldWriteRepository implements LegalHoldWriteRepository {
  constructor(private readonly db: DatabasePort) {}

  async getActive(orgId: OrgId, artifactId: string): Promise<ActiveHold | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; artifact_id: string; reason: string; applied_by: string; applied_at: Date }>(
        `SELECT id, artifact_id, reason, applied_by, applied_at FROM legal_holds
          WHERE org_id = $1 AND artifact_id = $2 AND released_at IS NULL`,
        [orgId, artifactId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        holdId: row.id,
        artifactId: row.artifact_id,
        reason: row.reason,
        appliedBy: row.applied_by,
        appliedAt: row.applied_at,
      };
    });
  }

  async apply(input: {
    orgId: OrgId;
    holdId: string;
    artifactId: string;
    reason: string;
    appliedBy: string;
    appliedAt: Date;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO legal_holds (id, org_id, artifact_id, reason, applied_by, applied_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.holdId, input.orgId, input.artifactId, input.reason, input.appliedBy, input.appliedAt],
      );
    });
  }

  async release(input: {
    orgId: OrgId;
    holdId: string;
    releasedBy: string;
    releasedAt: Date;
    releaseReason: string;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `UPDATE legal_holds SET released_by = $3, released_at = $4, release_reason = $5
          WHERE org_id = $1 AND id = $2 AND released_at IS NULL`,
        [input.orgId, input.holdId, input.releasedBy, input.releasedAt, input.releaseReason],
      );
    });
  }
}
