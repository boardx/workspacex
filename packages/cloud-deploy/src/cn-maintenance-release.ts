/** Separate maintenance coordinator. No production adapter is supplied by this
 * module: missing real restore/writer controls must fail closed, never fall back
 * to the normal provision entry point or an image rollback. */
export interface MaintenanceIdentity {
  sourceRevision: string;
  baselineRevision: string;
  migrationPlanSha256: string;
  attemptId: string;
}
export interface MaintenanceRequest extends MaintenanceIdentity {
  maintenanceOptIn: "stop-all-writes-and-require-database-recovery";
}
export interface MaintenanceOperations {
  prepareOffline(identity: MaintenanceIdentity): Promise<void>;
  acquireReleaseLock(identity: MaintenanceIdentity): Promise<() => Promise<void>>;
  /** Must replay hash-bound three-database restore-fidelity proofs and verify a
   * usable production recovery adapter; an accepted JSON flag is insufficient. */
  verifyThreeDatabaseRecovery?: (identity: MaintenanceIdentity) => Promise<void>;
  /** Durable hold is written before any writer is blocked; release automation
   * must retain it on failure or unknown outcome. */
  persistMaintenanceHold?: (identity: MaintenanceIdentity) => Promise<void>;
  blockAllWrites?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyAllWritersDrained?: (identity: MaintenanceIdentity) => Promise<void>;
  migrateExactPlan?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyProductionDynamic?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyPreactivate?: (identity: MaintenanceIdentity) => Promise<void>;
  activate?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyAcceptance?: (identity: MaintenanceIdentity) => Promise<void>;
  resumeWritesAndClearHold?: (identity: MaintenanceIdentity) => Promise<void>;
  recordDatabaseRecoveryRequired?: (identity: MaintenanceIdentity) => Promise<void>;
}
export class MaintenanceRecoveryRequired extends Error {
  constructor() { super("MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD"); }
}
export async function runMaintenanceRelease(request: MaintenanceRequest, ops: MaintenanceOperations): Promise<void> {
  if (request.maintenanceOptIn !== "stop-all-writes-and-require-database-recovery") throw new Error("MAINTENANCE_OPT_IN_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(request.sourceRevision) || !/^[a-f0-9]{40}$/.test(request.baselineRevision) ||
      !/^[a-f0-9]{64}$/.test(request.migrationPlanSha256) || !/^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId)) throw new Error("MAINTENANCE_IDENTITY_INVALID");
  const required = ["verifyThreeDatabaseRecovery", "persistMaintenanceHold", "blockAllWrites", "verifyAllWritersDrained", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance", "resumeWritesAndClearHold", "recordDatabaseRecoveryRequired"] as const;
  for (const name of required) if (typeof ops[name] !== "function") throw new Error(`MAINTENANCE_CAPABILITY_MISSING:${name}`);
  // Freeze a primitive-only identity so adapters cannot redirect a later stage.
  const identity: MaintenanceIdentity = Object.freeze({ sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId });
  // No production-schema dynamic gate here; preparation is immutable/offline.
  await ops.prepareOffline(identity);
  const releaseLock = await ops.acquireReleaseLock(identity);
  let hold = false;
  try {
    await ops.verifyThreeDatabaseRecovery!(identity);
    // From this point unknown outcomes require recovery. Set before awaiting
    // persistence, which can succeed remotely even when its response is lost.
    hold = true;
    await ops.persistMaintenanceHold!(identity);
    await ops.blockAllWrites!(identity);
    await ops.verifyAllWritersDrained!(identity);
    await ops.migrateExactPlan!(identity);
    await ops.verifyProductionDynamic!(identity);
    await ops.verifyPreactivate!(identity);
    await ops.activate!(identity);
    await ops.verifyAcceptance!(identity);
    await ops.resumeWritesAndClearHold!(identity);
    hold = false;
  } catch (error) {
    if (hold) {
      try { await ops.recordDatabaseRecoveryRequired!(identity); } catch { /* durable hold remains authoritative */ }
      throw new MaintenanceRecoveryRequired();
    }
    throw error;
  } finally {
    try { await releaseLock(); } catch {
      if (hold) throw new MaintenanceRecoveryRequired();
      throw new Error("MAINTENANCE_RELEASE_LOCK_CLEANUP_FAILED");
    }
  }
}
