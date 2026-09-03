/**
 * Database port -- defined by the application layer, implemented by `infrastructure`
 * (dependency inversion).
 *
 * Why "tenant context" appears explicitly in the port: RLS works through
 * `SET LOCAL app.current_org`, and `SET LOCAL` is scoped to a transaction. Hiding
 * that inside connection-pool behaviour (what ORMs typically do) makes "which tenant
 * context does this query run under" unreadable -- and the whole value of this kernel
 * is that the answer stays readable and assertable (UC-0.6 A-4). So the port forces
 * the caller to name the tenant: `withTenant(orgId, fn)`.
 */
import type { OrgId } from "../../domain/org-id";

export interface QueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
}

export interface TenantSession {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface DatabasePort {
  /**
   * Run inside a transaction bound to the given tenant. The implementation must issue
   * `SET LOCAL app.current_org` within that transaction, so the setting dies with the
   * transaction and never leaks to the next user of the pooled connection.
   */
  withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T>;

  /**
   * Run with NO tenant context (kernel self-checks and health probes only).
   *
   * Business queries must not use this: the policy is fail-closed, so this path reads
   * zero rows and looks like "no data" rather than "error" -- the hardest class of bug
   * to track down.
   */
  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

/**
 * The DI token lives next to the port: `interface` and the composition root import it,
 * while `infrastructure` only implements the interface.
 */
export const DATABASE_PORT = Symbol("DatabasePort");

/**
 * A SECOND `DatabasePort` instance, backed by a genuinely separate, less-privileged DB
 * credential (`pg-config.ts`'s `diagnosticsReaderConfig()`) than `DATABASE_PORT`'s `app_rw`.
 * Same interface -- `DatabasePort` has no notion of "which role this is" baked into its
 * shape, which is exactly why a second token, not a second interface, is what's needed here.
 *
 * Today's only consumer: `PgErrorLogWriter.list()`. See `pg-config.ts`'s file header for why
 * this exists (review finding, PR #2475: a `SECURITY DEFINER` function callable by `app_rw`
 * is not actually separated from `app_rw`'s own blast radius -- anything that can run SQL
 * over that connection could call it).
 */
export const DIAGNOSTICS_READER_DB_PORT = Symbol("DiagnosticsReaderDatabasePort");
