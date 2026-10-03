import { createHash } from 'node:crypto';
import { closeSync, readFileSync } from 'node:fs';
import { protectedPrivateJson, protectedExecutable, inheritedFd9Lock, runFixedPython } from './fixed_transport';
import { runHostMaintenanceRetainingFd9, type HostBinding } from './controller';
import { productionPrimitives, type ProductionBindings } from './production_factory';
import { bindTypedProductionOperations, type ProtectedOperationInputs } from './typed_operations';

export interface EntryPlan {
 schemaVersion: 1;
 productionActionsAuthorized: true;
 identity: ProductionBindings['identity'];
 host: HostBinding;
 production: ProductionBindings;
 recoveryPlanPath: string;
 recoveryPlanSha256: string;
}
function reject(message: string): never { throw new Error(message); }
function same(a: unknown,b: object): boolean {return !!a&&typeof a==='object'&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')&&Object.entries(b).every(([k,v])=>(a as Record<string,unknown>)[k]===v);}
/** Static source-owned consumer registry. New consumers are added in source and
 * compiled into the approved CJS closure, never loaded from a private plan,
 * arbitrary module path, NODE_OPTIONS or an untrusted JS callback. */
export const consumerImplementations: Partial<ProtectedOperationInputs> = {};
export function parseEntryPlan(value: unknown): EntryPlan {
 if (!value || typeof value!=='object') reject('HOST_PLAN_SCHEMA');
 const plan=value as EntryPlan;
 if (Object.keys(plan).sort().join(',')!==['schemaVersion','productionActionsAuthorized','identity','host','production','recoveryPlanPath','recoveryPlanSha256'].sort().join(',') || plan.schemaVersion!==1 || plan.productionActionsAuthorized!==true) reject('HOST_PLAN_SCHEMA');
 const id=plan.identity;
 if (!id || Object.keys(id).sort().join(',')!=='attemptId,baselineRevision,migrationPlanSha256,sourceRevision' || !/^[a-f0-9]{40}$/.test(id.sourceRevision)||!/^[a-f0-9]{40}$/.test(id.baselineRevision)||!/^[a-f0-9]{64}$/.test(id.migrationPlanSha256)||!/^[A-Za-z0-9-]{1,128}$/.test(id.attemptId))reject('HOST_PLAN_IDENTITY');
 if (!plan.host||!plan.production||!same(plan.host.identity,id)||!same(plan.production.identity,id))reject('HOST_PLAN_IDENTITY');
 if (plan.recoveryPlanPath!==`/etc/workspacex-cn/maintenance-recovery/${id.sourceRevision}/${id.attemptId}/recovery-plan.json`||!/^[a-f0-9]{64}$/.test(plan.recoveryPlanSha256))reject('HOST_PLAN_RECOVERY_BINDING');
 if(plan.production.recoveryPreflight?.planPath!==plan.recoveryPlanPath||plan.production.recoveryPreflight?.planSha256!==plan.recoveryPlanSha256||plan.production.recoveryPreflight?.command.path!=='/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py')reject('HOST_PLAN_RECOVERY_BINDING');
 return plan;
}
export async function executeBoundEntry(plan: EntryPlan, inputs: Partial<ProtectedOperationInputs>, verifyProfile: (host: HostBinding, bindings: ProductionBindings)=>Promise<void>) {
 // Typed consumers must all exist before capability checks, lock release,
 // maintenance hold creation, writer changes or database/traffic operations.
 const actions=await bindTypedProductionOperations(inputs);
 const primitives=productionPrimitives(plan.production,runFixedPython,verifyProfile,inheritedFd9Lock);
 Object.assign(primitives,actions);
 await runHostMaintenanceRetainingFd9({...plan.identity,maintenanceOptIn:'stop-all-writes-and-require-database-recovery'},plan.host,primitives,runFixedPython);
}
export async function main(args: readonly string[]): Promise<void> {
 if(process.platform!=='linux'||process.getuid?.()!==0)reject('ROOT_LINUX_REQUIRED');
 if(args.length!==3||args[0]!=='--run-reviewed-maintenance'||typeof args[1]!=='string'||typeof args[2]!=='string'||!/^\/etc\/workspacex-cn\//.test(args[1])||!/^[a-f0-9]{64}$/.test(args[2]))reject('HOST_ENTRY_USAGE');
 const plan=parseEntryPlan(protectedPrivateJson(args[1],args[2]));
 const profile=protectedPrivateJson('/etc/workspacex-cn/trusted-tool-binding.json') as any;
 if(profile.toolRevision!==plan.production.toolRevision)reject('HOST_PROFILE_TOOL_REVISION');
 const descriptor=profile.maintenanceHostController;
 if(!descriptor||descriptor.toolRevision!==profile.toolRevision||profile.filesSha256?.[descriptor.sourcePath]!==descriptor.sha256||descriptor.path!==process.argv[1]||!descriptor.path.endsWith('.cjs'))reject('HOST_ENTRY_PROFILE_BINDING');
 const fd=protectedExecutable(descriptor);try{if(createHash('sha256').update(readFileSync(fd)).digest('hex')!==descriptor.sha256)reject('HOST_ENTRY_PROFILE_BINDING');}finally{closeSync(fd);}
 // Validate inherited lock only, without releasing it while startup admission
 // still lacks production inputs. The launcher remains sole lock acquirer.
 await inheritedFd9Lock();
 await executeBoundEntry(plan,consumerImplementations,async(host,binding)=>{
  const commands=[host.hold,host.writerFence,binding.recoveryPreflight.command,...Object.values(binding.operations).map(op=>op.command)];
  for(const command of commands){const hash=profile.installedFilesSha256?.[command.path];if(hash!==command.sha256)reject('HOST_COMMAND_PROFILE_BINDING');const fd=protectedExecutable(command);closeSync(fd);}
 });
}
// esbuild bundle CJS preserves this direct-entry guard; imported source remains
// inert for pure parser tests. No subprocess or environment fallback is used.
if(process.argv[1]?.endsWith('cn-maintenance-host-controller.cjs'))main(process.argv.slice(2)).catch(error=>{const code=error instanceof Error?error.message:'';process.stderr.write(code.startsWith('PROTECTED_OPERATIONS_MISSING:')&&/^[A-Za-z0-9_.,:]+$/.test(code)?code+'\n':'MAINTENANCE_HOST_ENTRY_REJECTED\n');process.exitCode=1;});
