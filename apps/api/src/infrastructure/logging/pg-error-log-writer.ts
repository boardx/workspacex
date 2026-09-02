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
 * ## Every INSERT goes through `redactErrorDetail` first (2026-09-01 review finding #1)
 *
 * `record()` never writes `entry.detail` as-is -- see `error-log.port.ts`'s
 * `redactErrorDetail` for the bound+scrub it applies and why raw `err.message`/`stack`
 * (routinely containing SQL fragments, connection strings, table names -- `ConsoleLogger`'s
 * own header says so) is an acceptable risk for journald but not for a queryable, 30-day
 * Postgres archive without that step.
 *
 * ## Read access: no new HTTP surface, and the app role structurally cannot SELECT either
 *
 * This feature was scoped, with the human's explicit sign-off, to "a Postgres table +
 * `SELECT ... WHERE trace_id = ...` by whoever already has deploy-machine DB credentials" --
 * NOT a new HTTP endpoint or a new "superuser" role (this codebase has no such role today;
 * building one is a real access-control design task, out of scope for this fix, tracked as a
 * follow-up if ever wanted). So the blast radius of a *read* of this table is bounded to
 * "whoever can already open a `psql` session against production" -- the same population that
 * could already `journalctl | grep` the un-redacted console log this table sits alongside.
 * `redactErrorDetail` narrows what is IN the table; it does not additionally restrict who can
 * query it against production, because no new reader was introduced for it to restrict.
 *
 * That is about the human operator population; it is a separate question from what the
 * running API *process* itself (the `app_rw` role, see `pg-config.ts`) can do with its own
 * live credentials if something upstream of this file goes wrong (an injection bug elsewhere,
 * a compromised dependency). 2026-09-01 review finding #1 named that gap precisely: the
 * migration granted `app_rw` everything by omission-of-a-narrower-grant. The migration now
 * `REVOKE`s ALL and grants back only `INSERT, DELETE` -- what `record()` and
 * `sweepExpiredErrorLogs` actually do -- so the app role cannot `SELECT` this table even if
 * something got it to try. See the migration's own header for the mechanics and for the
 * production-breaking bug this same gap caused (the table had no grant at all).
 *
 * ## Retention: best-effort, NOT a guarantee (2026-09-01 review finding #2 -- corrected)
 *
 * The original version of this file's cadence (only ever triggered from inside `record()`,
 * once every `HOUSEKEEPING_EVERY` writes) has a real gap the review named precisely: a
 * low-volume deployment, or a process restart before the counter reaches the threshold, or a
 * permanently-failing DELETE, all mean rows past `RETENTION_DAYS` can persist indefinitely.
 * There is no promise here that fixes that completely -- this codebase has no cron/scheduler
 * infrastructure to hang a truly independent sweep off (same constraint as the first version).
 * What changed: `sweepExpiredErrorLogs` is now also called once at process boot
 * (`main.ts`, mirroring the exact pattern `ensurePlatformSkillCatalogSeeded` already
 * established for self-healing on every real start -- never throws, logs and moves on),
 * so a restart is now a SECOND independent trigger, not the failure mode described above.
 * Between the two, most real deployments (anything that restarts periodically, or writes more
 * than `HOUSEKEEPING_EVERY` errors before 30 days pass) get cleanup within a bounded window.
 * A deployment that does neither -- never restarts AND stays under the write threshold for
 * 30+ days -- will accumulate rows. That is named here, not hidden: this is BEST-EFFORT
 * retention, not an enforced TTL. A DB-native mechanism (e.g. `pg_cron`, if the extension is
 * ever provisioned) would close the remaining gap; it is not part of this change.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  redactErrorDetail,
  type ErrorLogEntry,
  type ErrorLogListItem,
  type ErrorLogPort,
} from "../../application/ports/error-log.port";

export const RETENTION_DAYS = 30;
/** Run housekeeping roughly once every this-many writes, not on every single one. */
const HOUSEKEEPING_EVERY = 50;

/**
 * Delete rows older than `RETENTION_DAYS`. Exported so it can be triggered from two
 * independent places (`PgErrorLogWriter`'s opportunistic per-write cadence, and `main.ts`'s
 * boot-time self-heal) without either duplicating the SQL -- the "one fact, two callers" shape
 * this codebase's own AGENTS.md names as the alternative to "one fact declared twice".
 *
 * Never throws: a failed sweep is not a reason to fail whatever triggered it. Callers that
 * care whether it actually ran can inspect the resolved boolean; callers that do not
 * (`record()`'s opportunistic trigger) can ignore it.
 */
export async function sweepExpiredErrorLogs(db: DatabasePort): Promise<{ readonly ok: boolean; readonly error?: unknown }> {
  try {
    await db.withoutTenant((s) =>
      s.query(`DELETE FROM error_logs WHERE created_at < now() - interval '${RETENTION_DAYS} days'`),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export class PgErrorLogWriter implements ErrorLogPort {
  private writeCount = 0;

  constructor(private readonly db: DatabasePort) {}

  async record(entry: ErrorLogEntry): Promise<void> {
    const detail = redactErrorDetail(entry.detail);
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO error_logs (trace_id, msg, detail) VALUES ($1, $2, $3::jsonb)`,
        [entry.traceId, entry.msg, JSON.stringify(detail)],
      );
    });

    this.writeCount += 1;
    if (this.writeCount % HOUSEKEEPING_EVERY === 0) {
      await sweepExpiredErrorLogs(this.db);
    }
  }

  /**
   * Newest-first by `id` (see the port's doc comment for why `beforeId`, not `offset`).
   * `withoutTenant`, same reasoning as `record()` and `sweepExpiredErrorLogs`: this table has
   * no `org_id`, there is no tenant to scope a read to.
   *
   * ⚠ Reads `limit + 1` rows to derive `hasMore` from one query, rather than a second
   *   `COUNT(*)` round trip -- the extra row is trimmed off before returning.
   */
  async list(input: { readonly limit: number; readonly beforeId: string | null }): Promise<{
    readonly items: readonly ErrorLogListItem[];
    readonly hasMore: boolean;
  }> {
    const fetchLimit = input.limit + 1;
    const rows = await this.db.withoutTenant((s) =>
      input.beforeId === null
        ? s.query<{ id: string; trace_id: string; msg: string; detail: unknown; created_at: Date }>(
            `SELECT id, trace_id, msg, detail, created_at FROM error_logs ORDER BY id DESC LIMIT $1`,
            [fetchLimit],
          )
        : s.query<{ id: string; trace_id: string; msg: string; detail: unknown; created_at: Date }>(
            `SELECT id, trace_id, msg, detail, created_at FROM error_logs WHERE id < $1 ORDER BY id DESC LIMIT $2`,
            [input.beforeId, fetchLimit],
          ),
    );
    const hasMore = rows.rows.length > input.limit;
    const page = hasMore ? rows.rows.slice(0, input.limit) : rows.rows;
    return {
      items: page.map((r) => ({
        id: String(r.id),
        traceId: r.trace_id,
        msg: r.msg,
        detail: r.detail,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      hasMore,
    };
  }
}
