/**
 * Kernel health -- an operator-facing self-check result.
 *
 * It must NOT carry connection strings, role names, migration SQL or any other
 * deployment detail (UC-0.6 R5). Booleans and a version only: it can answer
 * "is RLS still forced?" but cannot answer "where is your database?".
 */
export interface KernelHealth {
  /** Filename of the most recently applied migration (no path) */
  readonly migrationVersion: string | null;
  /** Are ALL RLS-enabled tables FORCEd? A single table that is not makes this false */
  readonly rlsForced: boolean;
  /**
   * Whether the application role owns any table.
   *
   * Must always be false. In PostgreSQL a table owner bypasses RLS by default, so
   * connecting as the owner means RLS is written but not in effect -- and everything
   * looks fine on the surface. Surfacing it in the health check makes "someone changed
   * the connection to the owner" fail loudly instead of waiting for a leak.
   */
  readonly appRoleIsOwner: boolean;
}

/** Is the kernel in a trustworthy state? A failure here is not "degraded", it is untrusted. */
export function isKernelTrustworthy(h: KernelHealth): boolean {
  return h.rlsForced && !h.appRoleIsOwner && h.migrationVersion !== null;
}
