/**
 * `PgErrorLogWriter` -- the `ErrorLogPort` implementation. See that port's file header for
 * why this exists and why it only ever records the "truly unhandled" bucket.
 *
 * ## `withoutTenant`, and why that is the right call here (not a shortcut around it)
 *
 * `DatabasePort.withoutTenant`'s own doc comment warns "business queries must not use this...
 * reads zero rows and looks like 'no data' rather than 'error'". `error_logs` is not a
 * business table: it has no `org_id` (see the migration's header), is infrastructure
 * self-observation in the same class as `_kernel_migrations` (which `pgHealthProbe` already
 * reads via `withoutTenant`), and routinely needs to record errors that happen BEFORE any
 * tenant context exists -- a failed login never resolved an organization, so there is no
 * tenant to scope the write to even if this table had a column for one.
 *
 * ## Retention: opportunistic, not a cron job
 *
 * This table has no scheduled cleanup process (there is no existing cron/scheduler
 * infrastructure in this codebase to hang one off -- see the design discussion this shipped
 * with). Instead, each write has a small independent chance of also deleting rows older than
 * `RETENTION_DAYS`: cheap on the common path (no-op almost always), and self-correcting even
 * if this process is the only one ever writing here. A fixed modulus on an in-memory counter
 * (not `Math.random()`) makes the cadence deterministic and testable.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ErrorLogEntry, ErrorLogPort } from "../../application/ports/error-log.port";

const RETENTION_DAYS = 30;
/** Run housekeeping roughly once every this-many writes, not on every single one. */
const HOUSEKEEPING_EVERY = 50;

export class PgErrorLogWriter implements ErrorLogPort {
  private writeCount = 0;

  constructor(private readonly db: DatabasePort) {}

  async record(entry: ErrorLogEntry): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO error_logs (trace_id, msg, detail) VALUES ($1, $2, $3::jsonb)`,
        [entry.traceId, entry.msg, JSON.stringify(entry.detail)],
      );
    });

    this.writeCount += 1;
    if (this.writeCount % HOUSEKEEPING_EVERY === 0) {
      // Best-effort: a failed cleanup is not a reason to fail the write that triggered it,
      // and it will simply get another chance on a later write.
      await this.db
        .withoutTenant((s) =>
          s.query(`DELETE FROM error_logs WHERE created_at < now() - interval '${RETENTION_DAYS} days'`),
        )
        .catch(() => undefined);
    }
  }
}
