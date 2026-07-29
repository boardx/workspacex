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
