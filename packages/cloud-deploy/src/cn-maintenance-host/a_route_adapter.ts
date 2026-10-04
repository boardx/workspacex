import type { MaintenanceIdentity } from '../cn-maintenance-release';
import type { ARouteOperations } from './a_route';
import type { HostBinding } from './controller';
import type { CommandRunner } from './fixed_transport';
import { bindPublicAcceptance, type PublicAcceptanceBinding, type PublicAcceptanceTransport } from './public_acceptance';

/** Source-owned methods, never an operation registry deserialized from a plan. */
type HoldOperations = 'persistMaintenanceHold' | 'verifyMaintenanceHoldPresent' | 'clearAndVerifyMaintenanceHold';
export type ARouteHostActions = Omit<ARouteOperations, HoldOperations>;
export interface ARouteAdapterInputs {
  binding: HostBinding;
  publicAcceptance?: {binding: PublicAcceptanceBinding; transport: PublicAcceptanceTransport};
  actions: Partial<ARouteHostActions>;
  run: CommandRunner;
  /** Checks installed executable closure and actual candidate transport capability. */
  assertProtectedInputs: () => Promise<void>;
}
const actionNames = [
  'acquireReleaseLock', 'prepareOffline', 'verifyPreholdRecoveryCapability',
  'verifyIsolatedCandidateAcceptance', 'blockAllWrites', 'verifyWritesBlocked',
  'captureAndVerifyCurrentEpochRecovery', 'verifyCurrentEpochIsolatedCandidateAcceptance',
  'migrateExactPlan', 'verifyHeldCandidateReadback', 'stageCandidateRuntime',
  'verifyCandidateRuntimeIdentity', 'persistCandidateResumeIntent',
  'resumeExactCandidateWriters', 'verifyCandidateWritersResumed', 'verifyPublicAcceptance', 'observeOpenedCandidate',
  'blockCandidateWriters', 'verifyNoMigrationCommitted', 'resumeUnchangedBaselineCancellation',
  'verifyBaselineCancellation', 'recordRecoveryRequired', 'recordReconciliationRequired',
] as const satisfies readonly (keyof ARouteHostActions)[];
const same = (a: unknown, b: MaintenanceIdentity) => !!a && typeof a === 'object' &&
  Object.keys(a).sort().join(',') === Object.keys(b).sort().join(',') &&
  Object.entries(b).every(([k, v]) => (a as Record<string, unknown>)[k] === v);
function record(value: any, identity: MaintenanceIdentity, state: string) {
  if (!value || value.schemaVersion !== 1 || value.state !== state || !same(value.identity, identity) ||
    !/^[a-f0-9]{32}$/.test(value.generation) || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.device) || !Number.isSafeInteger(value.inode)) throw Error('A_ROUTE_HOLD_READBACK_INVALID');
  return value;
}
/** Concrete hold transport reuses the installed hold command and CAS protocol.
 * All other operations are compiled host consumers. In particular, old baseline
 * resume callbacks cannot stand in for candidate-only journal/socket proof. */
export async function bindARouteHostOperations(input: ARouteAdapterInputs): Promise<ARouteOperations> {
  const { binding } = input;
  const identity = Object.freeze({ ...binding.identity });
  if (Object.keys(identity).sort().join(',') !== 'attemptId,baselineRevision,migrationPlanSha256,sourceRevision' ||
    !/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !/^[a-f0-9]{40}$/.test(identity.baselineRevision) ||
    !/^[a-f0-9]{64}$/.test(identity.migrationPlanSha256) || !/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId)) throw Error('A_ROUTE_ADAPTER_IDENTITY_INVALID');
  if (typeof input.run !== 'function' || typeof input.assertProtectedInputs !== 'function' ||
    !binding.hold?.path.startsWith('/usr/local/lib/workspacex-cn/') || binding.hold.path.split('/').includes('..') ||
    !/^[a-f0-9]{64}$/.test(binding.hold.sha256)) throw Error('A_ROUTE_ADAPTER_TRANSPORT_INVALID');
  const command = Object.freeze({ ...binding.hold });
  const run = input.run;
  const available = { ...input.actions, ...(input.publicAcceptance ? bindPublicAcceptance(input.publicAcceptance.binding,input.publicAcceptance.transport) : {}) };
  const missing = actionNames.filter(name => typeof available[name] !== 'function');
  if (missing.length) throw Error('A_ROUTE_HOST_CAPABILITY_MISSING:' + missing.sort().join(','));
  // Snapshot callbacks before admission I/O so later object mutation cannot switch
  // transport implementations after protected profile verification.
  const actions = Object.fromEntries(actionNames.map(name => [name, available[name]!.bind(available)])) as ARouteHostActions;
  await input.assertProtectedInputs();
  let originalHold: any;
  const check = (value: MaintenanceIdentity) => { if (!same(value, identity)) throw Error('A_ROUTE_ADAPTER_IDENTITY_CHANGED'); };
  async function hold(action: string, data?: unknown) {
    const response = await run(command, [action, '/var/lib/workspacex-cn/runtime'], data);
    try { return JSON.parse(response.stdout); } catch { throw Error('A_ROUTE_HOLD_RESPONSE_INVALID'); }
  }
  const result = Object.fromEntries(actionNames.map(name => [name, async (value: MaintenanceIdentity) => {
    check(value);
    return actions[name](identity);
  }])) as ARouteHostActions;
  return {
    ...result,
    persistMaintenanceHold: async value => {
      check(value); originalHold = record(await hold('create', identity), identity, 'held');
    },
    verifyMaintenanceHoldPresent: async value => {
      check(value); const current = record(await hold('read'), identity, 'held');
      if (originalHold && JSON.stringify(current) !== JSON.stringify(originalHold)) throw Error('A_ROUTE_HOLD_GENERATION_CHANGED');
      originalHold ??= current; // Lost create response is reconciled by independent read.
    },
    clearAndVerifyMaintenanceHold: async value => {
      check(value); if (!originalHold) throw Error('A_ROUTE_HOLD_CAS_INPUT_MISSING');
      const cleared = record(await hold('clear', originalHold), identity, 'cleared');
      const current = record(await hold('read'), identity, 'cleared');
      if (JSON.stringify(current) !== JSON.stringify(cleared)) throw Error('A_ROUTE_HOLD_CLEAR_READBACK_CHANGED');
      originalHold = undefined;
    },
  };
}
