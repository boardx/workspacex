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
  const startup=productionStartupPrimitives(binding,run,verifyInstalledProfile,inheritedLock);
  const result: HostPrimitives = {
    ...startup,
    assertTrustedBinding:async host=>{validate();await startup.assertTrustedBinding(host);},
    ...Object.fromEntries(productionActions.map(name => [name, (identity: MaintenanceIdentity) => invoke(name, binding.operations[name], identity)])),
  } as HostPrimitives;
  return result;
}

/** Typed production consumers do not execute the legacy operation-command
 * registry. Startup retains only actual capability, profile and lock checks. */
export function productionStartupPrimitives(binding:ProductionBindings,run:CommandRunner,verifyInstalledProfile:(host:HostBinding,plan:ProductionBindings)=>Promise<void>,inheritedLock:(identity:MaintenanceIdentity)=>Promise<()=>Promise<void>>):Pick<HostPrimitives,'assertTrustedBinding'|'verifyRecoveryExecutorCapability'|'acquireReleaseLock'> {
 const same=(a:unknown)=>!!a&&typeof a==='object'&&Object.keys(a).length===4&&Object.entries(binding.identity).every(([k,v])=>(a as Record<string,unknown>)[k]===v);
 return {
 assertTrustedBinding:async host=>{if(!/^[a-f0-9]{40}$/.test(binding.toolRevision)||!same(host.identity))throw Error('PRODUCTION_BINDING_INVALID');await verifyInstalledProfile(host,binding);},
 verifyRecoveryExecutorCapability:async identity=>{if(!same(identity))throw Error('PRODUCTION_IDENTITY_CHANGED');const op=binding.recoveryPreflight;if(op.command.path!=='/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py'||!op.planPath.startsWith('/etc/workspacex-cn/maintenance-recovery/')||!/^[a-f0-9]{64}$/.test(op.planSha256))throw Error('RECOVERY_PREFLIGHT_BINDING');const result=await run(op.command,['--preflight-capability',op.planPath]);let v:any;try{v=JSON.parse(result.stdout);}catch{throw Error('RECOVERY_PREFLIGHT_INVALID');}if(v.schemaVersion!==1||v.kind!=='production-recovery-preflight'||!same(v.identity)||v.toolRevision!==binding.toolRevision||v.planSha256!==op.planSha256||v.liveWritesHeldProven!==false||v.ready!==false)throw Error('RECOVERY_PREFLIGHT_INVALID');},
 acquireReleaseLock:inheritedLock,
 };
}
