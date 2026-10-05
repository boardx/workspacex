import { bindARouteHostOperations, type ARouteAdapterInputs } from './a_route_adapter';
import {aRouteOperationNames,type ARouteOperations} from './a_route';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import type { ActivationActions } from '../cn-fast-safe-release';
import { offlinePreparedAction, exactMigrationAction, preparedActivationAction, type ExactMigrationInputs, type ExactMigrationTransport } from './reused_actions';
import { maintenanceOfflinePreparedAction, maintenanceActivationAction } from './activation_transport';
import { productionDynamicActions } from './dynamic_gate';
import type { CommandRunner, TrustedExecutable } from './fixed_transport';

export interface ProtectedOperationInputs {
  lane?: 'maintenance';
  /** Compiled adapters only; not a private-plan operation registry. */
  aRouteInputs?: ARouteAdapterInputs;
  /** Already admitted by the compiled source consumer factory, never JSON. */
  admittedARoute?: ARouteOperations;
  preparedReceipt: unknown;
  preparedManifest: Buffer;
  verifyOfflineArtifacts: () => Promise<void>;
  migration: ExactMigrationInputs;
  migrationTransport: ExactMigrationTransport;
  activation: ActivationActions;
  /** Must perform pre-hold independent artifact replay, never echo a receipt.
   * The currently installed verifier requires hold and is not compatible here. */
  replayPreholdRecovery: (identity: MaintenanceIdentity) => Promise<void>;
  verifyCandidateAcceptance: (identity: MaintenanceIdentity) => Promise<void>;
  collector: TrustedExecutable;
  preactivateVerifier: TrustedExecutable;
  readValidatedReceipt: (identity: MaintenanceIdentity, release: string) => Promise<void>;
  runBash: CommandRunner;
  release: string;
  /** Root-private profile attests these exact supplied transport implementations. */
  assertProtectedInputs: () => Promise<void>;
}
const activationMethods = ['readBaselineFingerprint','drainRuns','promotePreparedPointer','activateTraffic','verifyCanonical','runBrowserSmoke','restoreBaseline','restorePointer'] as const;
/** Called by startup admission before lock acquisition, accumulating missing
 * implementations so users see a bounded plan instead of one failure at a time. */
export async function bindTypedProductionOperations(value: Partial<ProtectedOperationInputs>) {
  if(value.admittedARoute){
    if(typeof value.assertProtectedInputs!=='function')throw Error('A_ROUTE_SOURCE_ADMISSION_MISSING');
    for(const name of aRouteOperationNames)if(typeof value.admittedARoute[name]!=='function')throw Error('A_ROUTE_SOURCE_OPERATION_MISSING:'+name);
    await value.assertProtectedInputs();return {aRoute:Object.freeze({...value.admittedARoute})};
  }
  if (value.aRouteInputs) return { aRoute: await bindARouteHostOperations(value.aRouteInputs) };
  const missing: string[] = [];
  for (const key of ['verifyOfflineArtifacts','replayPreholdRecovery','verifyCandidateAcceptance','readValidatedReceipt','runBash','assertProtectedInputs'] as const) if (typeof value[key] !== 'function') missing.push(key);
  if (!Buffer.isBuffer(value.preparedManifest) || value.preparedReceipt === undefined) missing.push('preparedArtifacts');
  if (!value.migration) missing.push('migrationInputs');
  for (const key of ['migrate','readFreshCompletion','verifyLiveWriterBarrier'] as const) if (typeof value.migrationTransport?.[key] !== 'function') missing.push('migrationTransport.'+key);
  for (const key of activationMethods) if (typeof value.activation?.[key] !== 'function') missing.push('activation.'+key);
  if (!value.collector || !value.preactivateVerifier || !value.release) missing.push('dynamicInputs');
  if (missing.length) throw new Error('PROTECTED_OPERATIONS_MISSING:'+missing.sort().join(','));
  const input = value as ProtectedOperationInputs;
  await input.assertProtectedInputs();
  const dynamic = productionDynamicActions(input.collector,input.preactivateVerifier,input.release,input.runBash,input.readValidatedReceipt);
  return {
    prepareOffline: (input.lane === 'maintenance' ? maintenanceOfflinePreparedAction : offlinePreparedAction)(input.preparedReceipt,input.preparedManifest,input.verifyOfflineArtifacts),
    verifyThreeDatabaseRecovery: input.replayPreholdRecovery,
    migrateExactPlan: exactMigrationAction(input.migration,input.migrationTransport),
    ...dynamic,
    activate: (input.lane === 'maintenance' ? maintenanceActivationAction : preparedActivationAction)(input.preparedReceipt,input.activation),
    verifyAcceptance: input.verifyCandidateAcceptance,
  };
}
