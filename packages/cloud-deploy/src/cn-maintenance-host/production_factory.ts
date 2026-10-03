import type { MaintenanceIdentity } from '../cn-maintenance-release';
import type { HostBinding, HostPrimitives } from './controller';
import type { CommandRunner, TrustedExecutable } from './fixed_transport';

export const productionActions = ['prepareOffline', 'verifyThreeDatabaseRecovery', 'migrateExactPlan', 'verifyProductionDynamic', 'verifyPreactivate', 'activate', 'verifyAcceptance'] as const;
export interface BoundOperation { command: TrustedExecutable; planPath: string; planSha256: string }
export interface ProductionBindings {
  identity: MaintenanceIdentity;
  toolRevision: string;
  recoveryPreflight: BoundOperation;
  operations: Record<typeof productionActions[number], BoundOperation>;
}
/** This factory never supplies a normal deploy/provision fallback. Install-time
 * profile verification and FD9 ownership must come from the host entrypoint.
 * A command cannot substitute a boolean receipt for this exact protocol. */
export function productionPrimitives(binding: ProductionBindings, run: CommandRunner,
  verifyInstalledProfile: (host: HostBinding, plan: ProductionBindings) => Promise<void>,
  inheritedLock: (identity: MaintenanceIdentity) => Promise<() => Promise<void>>): HostPrimitives {
  const identityEqual = (value: unknown) => !!value && typeof value === 'object' && Object.keys(value).sort().join(',') === Object.keys(binding.identity).sort().join(',') && Object.entries(binding.identity).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected);
  const validate = () => {
    if (!/^[a-f0-9]{40}$/.test(binding.toolRevision) || !identityEqual(binding.identity)) throw new Error('PRODUCTION_BINDING_INVALID');
    if (Object.keys(binding.operations).sort().join(',') !== [...productionActions].sort().join(',')) throw new Error('PRODUCTION_OPERATION_SET_INVALID');
    for (const op of [binding.recoveryPreflight, ...productionActions.map(k => binding.operations[k])]) {
      if (!op || !op.planPath.startsWith('/etc/workspacex-cn/') || op.planPath.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(op.planSha256) || !op.command.path.startsWith('/usr/local/lib/workspacex-cn/') || !/^[a-f0-9]{64}$/.test(op.command.sha256)) throw new Error('PRODUCTION_OPERATION_BINDING_INVALID');
    }
  };
  const invoke = async (name: string, op: BoundOperation, identity: MaintenanceIdentity) => {
    if (!identityEqual(identity)) throw new Error('PRODUCTION_IDENTITY_CHANGED');
    const response = await run(op.command, ['--maintenance-operation', name, op.planPath, op.planSha256]);
    let value: any; try { value = JSON.parse(response.stdout); } catch { throw new Error('PRODUCTION_OPERATION_RESPONSE_INVALID'); }
    if (!value || value.schemaVersion !== 1 || value.kind !== 'maintenance-operation-completed' || value.operation !== name || !identityEqual(value.identity) || value.toolRevision !== binding.toolRevision || value.planSha256 !== op.planSha256 || value.ready !== false) throw new Error('PRODUCTION_OPERATION_RESPONSE_INVALID');
  };
  const result: HostPrimitives = {
    assertTrustedBinding: async host => { validate(); if (!identityEqual(host.identity)) throw new Error('PRODUCTION_IDENTITY_CHANGED'); await verifyInstalledProfile(host, binding); },
    verifyRecoveryExecutorCapability: async identity => {
      if (!identityEqual(identity)) throw new Error('PRODUCTION_IDENTITY_CHANGED');
      const op = binding.recoveryPreflight;
      const response = await run(op.command, ['--preflight-capability', op.planPath]);
      let value: any; try { value = JSON.parse(response.stdout); } catch { throw new Error('RECOVERY_PREFLIGHT_INVALID'); }
      if (!value || value.schemaVersion !== 1 || value.kind !== 'production-recovery-preflight' || !identityEqual(value.identity) || value.toolRevision !== binding.toolRevision || value.planSha256 !== op.planSha256 || value.liveWritesHeldProven !== false || value.ready !== false) throw new Error('RECOVERY_PREFLIGHT_INVALID');
    },
    acquireReleaseLock: inheritedLock,
    ...Object.fromEntries(productionActions.map(name => [name, (identity: MaintenanceIdentity) => invoke(name, binding.operations[name], identity)])),
  } as HostPrimitives;
  return result;
}
