import { runARouteMaintenanceRelease, type ARouteOperations } from './cn-maintenance-host/a_route';
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
  /** Source-owned A adapter only; never selected by a private-plan ready flag. */
  aRoute?: ARouteOperations;
  prepareOffline(identity: MaintenanceIdentity): Promise<void>;
  acquireReleaseLock(identity: MaintenanceIdentity): Promise<() => Promise<void>>;
  /** Must replay hash-bound three-database restore-fidelity proofs and verify a
   * usable production recovery adapter; an accepted JSON flag is insufficient. */
  verifyThreeDatabaseRecovery?: (identity: MaintenanceIdentity) => Promise<void>;
  /** Durable hold is written before any writer is blocked; release automation
   * must retain it on failure or unknown outcome. */
  persistMaintenanceHold?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyMaintenanceHoldPresent?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyMaintenanceHoldCleared?: (identity: MaintenanceIdentity) => Promise<void>;
  blockAllWrites?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyAllWritersDrained?: (identity: MaintenanceIdentity) => Promise<void>;
  migrateExactPlan?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyProductionDynamic?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyPreactivate?: (identity: MaintenanceIdentity) => Promise<void>;
  activate?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyAcceptance?: (identity: MaintenanceIdentity) => Promise<void>;
  resumeWrites?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyWritesResumed?: (identity: MaintenanceIdentity) => Promise<void>;
  clearMaintenanceHold?: (identity: MaintenanceIdentity) => Promise<void>;
  verifyWritesBlocked?: (identity: MaintenanceIdentity) => Promise<void>;
  recordWriteStateReconciliationRequired?: (identity: MaintenanceIdentity) => Promise<void>;
  recordDatabaseRecoveryRequired?: (identity: MaintenanceIdentity) => Promise<void>;
}
export class MaintenanceRecoveryRequired extends Error {
  constructor() { super("MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD"); }
}
export class MaintenanceWriteStateUnknown extends Error {
  constructor() { super("MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED"); }
}
export async function runMaintenanceRelease(request: MaintenanceRequest, ops: MaintenanceOperations): Promise<void> {
  if (ops.aRoute) return runARouteMaintenanceRelease(request, ops.aRoute);
  if (request.maintenanceOptIn !== "stop-all-writes-and-require-database-recovery") throw new Error("MAINTENANCE_OPT_IN_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(request.sourceRevision) || !/^[a-f0-9]{40}$/.test(request.baselineRevision) ||
      !/^[a-f0-9]{64}$/.test(request.migrationPlanSha256) || !/^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId)) throw new Error("MAINTENANCE_IDENTITY_INVALID");
  const required = ["verifyThreeDatabaseRecovery", "persistMaintenanceHold", "verifyMaintenanceHoldPresent", "verifyMaintenanceHoldCleared", "blockAllWrites", "verifyAllWritersDrained", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance", "resumeWrites", "verifyWritesResumed", "clearMaintenanceHold", "verifyWritesBlocked", "recordWriteStateReconciliationRequired", "recordDatabaseRecoveryRequired"] as const;
  for (const name of required) if (typeof ops[name] !== "function") throw new Error(`MAINTENANCE_CAPABILITY_MISSING:${name}`);
  // Freeze a primitive-only identity so adapters cannot redirect a later stage.
  const identity: MaintenanceIdentity = Object.freeze({ sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId });
  // No production-schema dynamic gate here; preparation is immutable/offline.
  const releaseLock = await ops.acquireReleaseLock(identity);
  let holdAttempted = false;
  let retainLock = false;
  try {
    await ops.prepareOffline(identity);
    await ops.verifyThreeDatabaseRecovery!(identity);
    // From this point unknown outcomes require readback/reconciliation. Set before awaiting
    // persistence, which can succeed remotely even when its response is lost.
    holdAttempted = true;
    await ops.persistMaintenanceHold!(identity);
    await ops.verifyMaintenanceHoldPresent!(identity);
    await ops.blockAllWrites!(identity);
    await ops.verifyAllWritersDrained!(identity);
    await ops.migrateExactPlan!(identity);
    await ops.verifyProductionDynamic!(identity);
    await ops.verifyPreactivate!(identity);
    await ops.activate!(identity);
    await ops.verifyAcceptance!(identity);
    await ops.resumeWrites!(identity);
    // Independent actual readback must precede clearing the durable hold.
    await ops.verifyWritesResumed!(identity);
    await ops.clearMaintenanceHold!(identity);
    await ops.verifyMaintenanceHoldCleared!(identity);
    holdAttempted = false;
  } catch (error) {
    if (holdAttempted) {
      try {
        await ops.verifyMaintenanceHoldPresent!(identity);
        await ops.verifyWritesBlocked!(identity);
      } catch {
        retainLock = true;
        try { await ops.recordWriteStateReconciliationRequired!(identity); } catch { /* lock retained; hold and write state unproven */ }
        throw new MaintenanceWriteStateUnknown();
      }
      try { await ops.recordDatabaseRecoveryRequired!(identity); } catch { /* hold and blocked writes were independently proven */ }
      throw new MaintenanceRecoveryRequired();
    }
    throw error;
  } finally {
    try { if (!retainLock) await releaseLock(); } catch {
      if (holdAttempted) throw new MaintenanceRecoveryRequired();
      throw new Error("MAINTENANCE_RELEASE_LOCK_CLEANUP_FAILED");
    }
  }
}
