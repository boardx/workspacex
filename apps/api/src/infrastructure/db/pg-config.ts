/**
 * Connection configuration. The application identity and the migration identity are
 * two different roles, deliberately kept apart.
 *
 * | identity       | purpose                | hard constraints                       |
 * |----------------|------------------------|----------------------------------------|
 * | migration role | run DDL, owns tables   | used only during migration             |
 * | application    | runtime reads/writes   | NOT a table owner, no BYPASSRLS, no DDL|
 * | diagnostics    | read `error_logs` ONLY | no INSERT/DELETE/UPDATE, no other table|
 *
 * In PostgreSQL a table owner bypasses RLS by default. Collapsing these two into one
 * connection string is the number one cause of "we thought RLS was on but it wasn't"
 * (UC-0.6 R7 / domain I-4).
 *
 * ## The third identity, and why it exists (review finding, PR #2475)
 *
 * A first attempt at the system-error-logs read path gave `app_rw` -- the SAME identity
 * every other request in this process runs as -- either table-wide `SELECT` on
 * `error_logs`, or (the second attempt) `EXECUTE` on a `SECURITY DEFINER` function reading
 * it. Both were the same mistake in different syntax: ANYTHING able to run SQL over the
 * `app_rw` connection (a SQL-injection bug elsewhere in this codebase, a compromised
 * dependency -- the exact threat model 2026-09-01 review finding #1 was written for) could
 * reach the diagnostic content, completely bypassing `PlatformSuperuserGuard` -- the guard
 * only gates the HTTP route, not the SQL connection everything in the process shares.
 *
 * `diagnosticsReaderConfig()` is a genuinely separate credential, wired to a SEPARATE
 * `DatabasePort` instance (`DIAGNOSTICS_READER_DB_PORT` in the composition root) that ONLY
 * `PgErrorLogWriter.list()` ever touches. `app_rw`'s own grants are UNCHANGED by this
 * (see `20260901024515`'s migration): it still cannot read `error_logs` at all, by any
 * route, direct SELECT or function call. A compromised `app_rw` session gains nothing new.
 */
export interface PgConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env var ${name}`);
  return v;
}

/** The APPLICATION identity used at runtime */
export function appConfig(): PgConfig {
  return {
    host: req("PGHOST", "127.0.0.1"),
    port: Number(req("PGPORT", "55432")),
    database: req("PGDATABASE", "workspacex"),
    user: req("APP_DB_USER", "app_rw"),
    password: req("APP_DB_PASSWORD", "app_rw_dev"),
  };
}

/** The OWNER identity, used only while migrating */
export function migrationConfig(): PgConfig {
  return {
    host: req("PGHOST", "127.0.0.1"),
    port: Number(req("PGPORT", "55432")),
    database: req("PGDATABASE", "workspacex"),
    user: req("MIGRATION_DB_USER", "postgres"),
    password: req("MIGRATION_DB_PASSWORD", "postgres_dev"),
  };
}

/**
 * The system-error-logs READ-ONLY identity -- see this file's header. Used by exactly one
 * caller (`PgErrorLogWriter.list()`), never by `app_rw`'s pool.
 */
export function diagnosticsReaderConfig(): PgConfig {
  return {
    host: req("PGHOST", "127.0.0.1"),
    port: Number(req("PGPORT", "55432")),
    database: req("PGDATABASE", "workspacex"),
    user: req("DIAG_DB_USER", "app_diag_ro"),
    password: req("DIAG_DB_PASSWORD", "app_diag_ro_dev"),
  };
}
