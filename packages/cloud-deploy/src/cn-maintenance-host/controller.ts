// Local staging import. Canonical mapping must retain this single existing state machine.
import { runMaintenanceRelease, MaintenanceWriteStateUnknown, MaintenanceRecoveryRequired, type MaintenanceIdentity, type MaintenanceRequest, type MaintenanceOperations } from '../cn-maintenance-release';
import { runARouteMaintenanceRelease, type ARouteOperations } from './a_route';
import { type CommandRunner, type TrustedExecutable } from './fixed_transport';

export const writerCallbacks = ['blockAllWrites', 'verifyAllWritersDrained', 'verifyWritesBlocked', 'resumeWrites', 'verifyWritesResumed', 'recordWriteStateReconciliationRequired', 'recordDatabaseRecoveryRequired'] as const;
export interface HostBinding {
  identity: MaintenanceIdentity;
  writerPlanPath: string;
  writerPlanSha256: string;
  /** Canonical JSON plan digest, distinct from private file raw-byte hash. */
  writerPlanCanonicalSha256: string;
  hold: TrustedExecutable;
  writerFence: TrustedExecutable;
}
/** Functions supplied by hash-bound root-private adapters, never receipt booleans.
 * Recovery must demonstrate its executable capability before acquiring the lock. */
export interface HostPrimitives {
  /** Source-owned A-route capabilities are admitted before any host mutation. */
  aRoute?: ARouteOperations;
  assertTrustedBinding(binding: HostBinding): Promise<void>;
  verifyRecoveryExecutorCapability(identity: MaintenanceIdentity): Promise<void>;
  acquireReleaseLock(identity: MaintenanceIdentity): Promise<() => Promise<void>>;
  prepareOffline(identity: MaintenanceIdentity): Promise<void>;
  verifyThreeDatabaseRecovery(identity: MaintenanceIdentity): Promise<void>;
  migrateExactPlan(identity: MaintenanceIdentity): Promise<void>;
  verifyProductionDynamic(identity: MaintenanceIdentity): Promise<void>;
  verifyPreactivate(identity: MaintenanceIdentity): Promise<void>;
  activate(identity: MaintenanceIdentity): Promise<void>;
  verifyAcceptance(identity: MaintenanceIdentity): Promise<void>;
}
function requireValue(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function sameIdentity(a: unknown, b: MaintenanceIdentity): boolean {
  if (!a || typeof a !== 'object') return false;
  const value = a as Record<string, unknown>;
  return Object.keys(value).sort().join(',') === Object.keys(b).sort().join(',') && Object.entries(b).every(([key, v]) => value[key] === v);
}
function parseOne(stdout: string): any {
  try { return JSON.parse(stdout); } catch { throw new Error('COMMAND_RESPONSE_INVALID'); }
}
function holdRecord(value: any, identity: MaintenanceIdentity, state: string): void {
  requireValue(value && value.schemaVersion === 1 && value.state === state && sameIdentity(value.identity, identity) &&
    /^[a-f0-9]{32}$/.test(value.generation) && /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.device) && Number.isSafeInteger(value.inode), 'HOLD_READBACK_INVALID');
}
export async function runHostMaintenance(request: MaintenanceRequest, binding: HostBinding, primitives: HostPrimitives, run: CommandRunner): Promise<void> {
  requireValue(request.maintenanceOptIn === 'stop-all-writes-and-require-database-recovery', 'MAINTENANCE_OPT_IN_REQUIRED');
  requireValue(/^[a-f0-9]{40}$/.test(request.sourceRevision) && /^[a-f0-9]{40}$/.test(request.baselineRevision) && /^[a-f0-9]{64}$/.test(request.migrationPlanSha256) && /^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId), 'MAINTENANCE_IDENTITY_INVALID');
  requireValue(sameIdentity(binding.identity, { sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId }), 'HOST_IDENTITY_MISMATCH');
  requireValue(binding.writerPlanPath.startsWith('/') && /^[a-f0-9]{64}$/.test(binding.writerPlanSha256) && /^[a-f0-9]{64}$/.test(binding.writerPlanCanonicalSha256), 'WRITER_PLAN_BINDING_INVALID');
  // Entire startup admission is before lock/hold/writer/DB/traffic mutations.
  await primitives.assertTrustedBinding(binding);
  await primitives.verifyRecoveryExecutorCapability(binding.identity);
  if (primitives.aRoute) {
    await runARouteMaintenanceRelease(request, primitives.aRoute);
    return;
  }
  let originalHold: any;
  let clearedHold: any;
  const hold = async (action: string, input?: unknown) => parseOne((await run(binding.hold, [action, '/var/lib/workspacex-cn/runtime'], input)).stdout);
  const ops: MaintenanceOperations = {
    acquireReleaseLock: primitives.acquireReleaseLock.bind(primitives),
    prepareOffline: primitives.prepareOffline.bind(primitives),
    verifyThreeDatabaseRecovery: primitives.verifyThreeDatabaseRecovery.bind(primitives),
    migrateExactPlan: primitives.migrateExactPlan.bind(primitives),
    verifyProductionDynamic: primitives.verifyProductionDynamic.bind(primitives),
    verifyPreactivate: primitives.verifyPreactivate.bind(primitives),
    activate: primitives.activate.bind(primitives),
    verifyAcceptance: primitives.verifyAcceptance.bind(primitives),
    persistMaintenanceHold: async identity => {
      const value = await hold('create', identity); holdRecord(value, identity, 'held'); originalHold = value;
    },
    verifyMaintenanceHoldPresent: async identity => {
      const value = await hold('read'); holdRecord(value, identity, 'held');
      // Lost create response can be reconciled from an independently read held record.
      if (originalHold) requireValue(JSON.stringify(value) === JSON.stringify(originalHold), 'HOLD_GENERATION_CHANGED');
      else originalHold = value;
    },
    clearMaintenanceHold: async identity => {
      requireValue(originalHold, 'HOLD_CAS_INPUT_MISSING');
      const value = await hold('clear', originalHold); holdRecord(value, identity, 'cleared'); clearedHold = value;
    },
    verifyMaintenanceHoldCleared: async identity => {
      const value = await hold('read'); holdRecord(value, identity, 'cleared');
      requireValue(clearedHold && JSON.stringify(value) === JSON.stringify(clearedHold), 'HOLD_CLEAR_READBACK_CHANGED');
    },
  };
  for (const callback of writerCallbacks) ops[callback] = async identity => {
    const value = parseOne((await run(binding.writerFence, ['--apply-reviewed-fence', binding.writerPlanPath, binding.writerPlanSha256, callback])).stdout);
    if (callback === 'verifyAllWritersDrained' || callback === 'verifyWritesBlocked') {
      requireValue(value && value.schemaVersion === 1 && value.kind === 'maintenance-writers-held' && value.ready === false && sameIdentity(value.identity, identity) &&
        originalHold && value.holdGeneration === originalHold.generation && value.holdSha256 === originalHold.sha256 && value.planSha256 === binding.writerPlanCanonicalSha256 &&
        typeof value.observedAt === 'number' && Number.isFinite(value.observedAt) && Date.now() / 1000 - value.observedAt >= 0 && Date.now() / 1000 - value.observedAt <= 30 &&
        value.host && typeof value.host.instanceId === 'string' && typeof value.host.bootId === 'string' &&
        value.databasePeers && Object.keys(value.databasePeers).sort().join(',') === 'workspacex,workspacex_agent,workspacex_memory' &&
        ['holdSha256', 'planSha256', 'observationSha256', 'databaseSessionsSha256'].every(key => /^[a-f0-9]{64}$/.test(value[key])) &&
        Array.isArray(value.families) && value.families.join(',') === 'http,socket,queue,background,agent,checkpoint,memory,privileged', 'WRITER_GUARD_RESPONSE_INVALID');
    } else {
      requireValue(value && value.callback === callback && sameIdentity(value.identity, identity) && value.ready === false && value.productionAvailabilityProven === false && typeof value.state === 'string', 'WRITER_RESPONSE_INVALID');
    }
    // Identity enforcement belongs to the protected plan consumer, not an echo flag.
    requireValue(sameIdentity(identity, binding.identity), 'WRITER_IDENTITY_CHANGED');
  };
  await runMaintenanceRelease(request, ops);
}

/** Production entry must use this wrapper: retaining a JS callback while letting
 * Node exit would silently close FD 9. Unknown writer state keeps the host process
 * and inherited lock alive for an explicit reconciliation operator. */
export async function runHostMaintenanceRetainingFd9(request: MaintenanceRequest, binding: HostBinding, primitives: HostPrimitives, run: CommandRunner): Promise<void> {
  try { await runHostMaintenance(request, binding, primitives, run); }
  catch (error) {
    if (!(error instanceof MaintenanceWriteStateUnknown) && !(error instanceof MaintenanceRecoveryRequired)) throw error;
    process.stderr.write(error instanceof MaintenanceRecoveryRequired ? 'MAINTENANCE_DATABASE_RECOVERY_REQUIRED_LOCK_RETAINED\n' : 'MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED\n');
    await new Promise<void>(() => { setInterval(() => {}, 60000); });
  }
}
