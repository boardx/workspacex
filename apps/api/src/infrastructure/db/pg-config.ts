import { readFileSync } from "node:fs";
import { RDS_TLS_EXCEPTION_KIND } from "@repo/cloud-deploy";
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
  readonly ssl?: { rejectUnauthorized: true; ca?: string };
  readonly connectionTimeoutMillis?: number;
  readonly statement_timeout?: number;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env var ${name}`);
  return v;
}

function transport(): Pick<PgConfig, "ssl" | "connectionTimeoutMillis" | "statement_timeout"> {
  const cloud = process.env.WORKSPACEX_DEPLOY_PROFILE;
  if (cloud && cloud !== "starter" && cloud !== "production") throw new Error("invalid WORKSPACEX_DEPLOY_PROFILE");
  if (cloud) for (const name of ["PGHOST", "PGDATABASE"]) req(name);
  const mode = process.env.PGSSLMODE ?? (cloud === "production" ? "verify-full" : "disable");
  const exception = process.env.WORKSPACEX_RDS_TLS_EXCEPTION;
  if (exception !== undefined && exception !== RDS_TLS_EXCEPTION_KIND) throw new Error("invalid RDS TLS exception");
  if (!["disable", "verify-full"].includes(mode) || (cloud === "production" && mode !== "verify-full" && exception !== RDS_TLS_EXCEPTION_KIND)) {
    throw new Error("PGSSLMODE must verify certificates in production");
  }
  const timeout = Number(process.env.PGCONNECT_TIMEOUT_MS ?? "5000");
  const statement = Number(process.env.PGSTATEMENT_TIMEOUT_MS ?? "30000");
  if (![timeout, statement].every(n => Number.isSafeInteger(n) && n > 0 && n <= 300000)) throw new Error("invalid PostgreSQL timeout");
  return { connectionTimeoutMillis: timeout, statement_timeout: statement,
    ...(mode === "verify-full" ? { ssl: { rejectUnauthorized: true as const,
      ...(process.env.PGSSLROOTCERT ? { ca: readFileSync(process.env.PGSSLROOTCERT, "utf8") } : {}) } } : {}) };
}

function port(): number {
  const value = Number(req("PGPORT", "55432"));
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("invalid PGPORT");
  return value;
}

function credential(name: string, fallback: string): string {
  const value = req(name, process.env.WORKSPACEX_DEPLOY_PROFILE ? undefined : fallback);
  if (process.env.WORKSPACEX_DEPLOY_PROFILE && value.length < 16) throw new Error(`invalid cloud credential ${name}`);
  return value;
}

/** The APPLICATION identity used at runtime */
export function appConfig(): PgConfig {
  return {
    ...transport(),
    host: req("PGHOST", "127.0.0.1"),
    port: port(),
    database: req("PGDATABASE", "workspacex"),
    user: req("APP_DB_USER", "app_rw"),
    password: credential("APP_DB_PASSWORD", "app_rw_dev"),
  };
}

/** The OWNER identity, used only while migrating */
export function migrationConfig(): PgConfig {
  return {
    ...transport(),
    host: req("PGHOST", "127.0.0.1"),
    port: port(),
    database: req("PGDATABASE", "workspacex"),
    user: req("MIGRATION_DB_USER", "postgres"),
    password: credential("MIGRATION_DB_PASSWORD", "postgres_dev"),
  };
}

/**
 * The system-error-logs READ-ONLY identity -- see this file's header. Used by exactly one
 * caller (`PgErrorLogWriter.list()`), never by `app_rw`'s pool.
 */
export function diagnosticsReaderConfig(): PgConfig {
  return {
    ...transport(),
    host: req("PGHOST", "127.0.0.1"),
    port: port(),
    database: req("PGDATABASE", "workspacex"),
    user: req("DIAG_DB_USER", "app_diag_ro"),
    password: credential("DIAG_DB_PASSWORD", "app_diag_ro_dev"),
  };
}
