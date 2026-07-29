/**
 * Use case: read kernel health.
 *
 * Depends only on `domain` and on ports it defines itself -- it knows nothing about
 * HTTP and nothing about PostgreSQL.
 */
import type { KernelHealth } from "../../domain/kernel-health";

export interface KernelHealthProbe {
  migrationVersion(): Promise<string | null>;
  /** Are ALL RLS-enabled tables FORCEd? */
  allRlsForced(): Promise<boolean>;
  /** Does the current connection identity own any table? */
  currentRoleOwnsTables(): Promise<boolean>;
}

export async function getKernelHealth(probe: KernelHealthProbe): Promise<KernelHealth> {
  const [migrationVersion, rlsForced, appRoleIsOwner] = await Promise.all([
    probe.migrationVersion(),
    probe.allRlsForced(),
    probe.currentRoleOwnsTables(),
  ]);
  return { migrationVersion, rlsForced, appRoleIsOwner };
}
