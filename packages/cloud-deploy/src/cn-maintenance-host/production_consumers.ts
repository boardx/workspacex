import { z } from 'zod';
import { protectedPrivateJson, protectedPrivateBytes, protectedExecutable, runFixedPython, runFixedBash, inheritedFd9Lock, type TrustedExecutable, type CommandRunner } from './fixed_transport';
import { closeSync } from 'node:fs';
import type { EntryPlan } from './entry';
import type { ProtectedOperationInputs } from './typed_operations';
import { createMigrationTransport, type MigrationHostBinding } from './migration_transport';
import type { ExactMigrationInputs } from './reused_actions';
import { fixedMaintenanceActivationActions, assertMaintenanceActivationCapability, type MaintenanceActivationBindings } from './activation_transport';
import { preholdRecoveryArtifactAudit } from './recovery_audit';
import { readProductionValidatedReceipt } from './dynamic_gate';
import { createPersistentWriterLifecycle, runtimeDigest } from './sealed_runtime';
import { writerCallbacks } from './controller';
import { verifyOfflineManifest } from './offline_artifacts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const path=z.string().startsWith('/etc/workspacex-cn/').refine(v=>!v.split('/').includes('..'));
const ref=z.object({path,sha256:hash}).strict();
const command=z.object({path:z.string().startsWith('/usr/local/lib/workspacex-cn/'),sha256:hash}).strict();
const schema=z.object({schemaVersion:z.literal(1),identity:z.object({sourceRevision:z.string(),baselineRevision:z.string(),migrationPlanSha256:hash,attemptId:z.string()}).strict(),toolRevision:z.string(),prepared:z.object({receipt:ref,manifest:ref}).strict(),migration:z.object({inputs:ref,binding:z.unknown()}).strict(),activation:z.unknown(),recoveryAudit:z.object({verifier:command,evidenceSha256:hash}).strict(),dockerRuntime:z.object({path:z.literal('/usr/bin/docker'),sha256:hash}).strict(),dynamic:z.object({collector:command,verifier:command,release:z.string()}).strict(),writerModules:z.object({writer_fence:command,fixed_probes:command,control_connection:command}).strict()}).strict();
function same(a:unknown,b:unknown){return runtimeDigest(a)===runtimeDigest(b);}
/** Only source-owned implementations are executable. Private inputs contain data
 * and descriptors which must match the exact installed profile closure. */
export interface ConsumerRuntime {
 assertActivationCapability:()=>void;
 acquireLock:typeof inheritedFd9Lock;
 readJson:typeof protectedPrivateJson;readBytes:typeof protectedPrivateBytes;
 verifyExecutable:(c:TrustedExecutable)=>void;
 lifecycle:typeof createPersistentWriterLifecycle;
 migration:typeof createMigrationTransport;
 activation:typeof fixedMaintenanceActivationActions;
}
const actualRuntime:ConsumerRuntime={assertActivationCapability:assertMaintenanceActivationCapability,acquireLock:inheritedFd9Lock,readJson:protectedPrivateJson,readBytes:protectedPrivateBytes,verifyExecutable:c=>{const fd=protectedExecutable(c);closeSync(fd);},lifecycle:createPersistentWriterLifecycle,migration:createMigrationTransport,activation:fixedMaintenanceActivationActions};
// Fixture substitutions are source-code arguments, never private-plan fields.
export async function createProductionConsumers(plan:EntryPlan,profile:any,fixture?:Partial<ConsumerRuntime>) {
 const io={...actualRuntime,...fixture};
 const v=schema.parse(io.readJson(plan.consumerInputsPath,plan.consumerInputsSha256));
 if(!same(v.identity,plan.identity)||v.toolRevision!==plan.production.toolRevision)throw Error('CONSUMER_INPUT_IDENTITY');
 io.assertActivationCapability();
 const verify=(c:TrustedExecutable)=>{if(profile.installedFilesSha256?.[c.path]!==c.sha256)throw Error('CONSUMER_PROFILE_BINDING');io.verifyExecutable(c);};
 const migrationInputs=io.readJson(v.migration.inputs.path,v.migration.inputs.sha256) as ExactMigrationInputs;
 const migrationBinding=v.migration.binding as MigrationHostBinding;
 const activationBinding=v.activation as MaintenanceActivationBindings;
 if(!same(migrationBinding?.identity,plan.identity)||!same(activationBinding?.identity,plan.identity)||activationBinding.toolRevision!==v.toolRevision)throw Error('CONSUMER_OPERATION_IDENTITY');
 const sourcePlan=io.readJson(plan.host.writerPlanPath,plan.host.writerPlanSha256) as Record<string,any>;
 const lifecycle=io.lifecycle({identity:plan.identity,toolRevision:v.toolRevision,sourcePlanPath:plan.host.writerPlanPath,sourcePlanSha256:plan.host.writerPlanSha256,sourcePlan,host:plan.host,modules:v.writerModules});
 const commands=[plan.host.writerFence,...Object.values(v.writerModules),v.recoveryAudit.verifier,v.dynamic.collector,v.dynamic.verifier,migrationBinding.collector,migrationBinding.writerFence,activationBinding.activationCommand,activationBinding.recoveryCommand];
 for(const c of commands)verify(c);
 // Missing or foreign commands fail before opening database connections.
 const host={...plan.host};
 let started=false;
 const boundMigration={...migrationBinding};
 try{
 const runWriter:CommandRunner=async(c,args,input)=>{
  if(c.path!==host.writerFence.path)return runFixedPython(c,args,input);
  const cb=args[3];if(args[0]!=='--apply-reviewed-fence'||args[1]!==host.writerPlanPath||args[2]!==host.writerPlanSha256||!writerCallbacks.includes(cb as any))throw Error('PERSISTENT_WRITER_ROUTING');
  if(!started){const sealed=await lifecycle.start();Object.assign(host,sealed);Object.assign(boundMigration,{writerPlanPath:host.writerPlanPath,writerPlanSha256:host.writerPlanSha256,writerPlanCanonicalSha256:host.writerPlanCanonicalSha256});started=true;}
  return lifecycle.invoke(cb as typeof writerCallbacks[number],plan.identity);
 };

 const activation={...io.activation(activationBinding,undefined,(identity,ref)=>lifecycle.recoverRetainedBaseline(identity,ref)),drainRuns:()=>lifecycle.readRunDrain(plan.identity)};
 const manifest=io.readBytes(v.prepared.manifest.path,v.prepared.manifest.sha256);
 const inputs:ProtectedOperationInputs={lane:'maintenance',preparedReceipt:io.readJson(v.prepared.receipt.path,v.prepared.receipt.sha256),preparedManifest:manifest,
 verifyOfflineArtifacts:verifyOfflineManifest(plan.identity,manifest,v.prepared.manifest.sha256,v.dockerRuntime),migration:migrationInputs,migrationTransport:io.migration(migrationInputs,boundMigration,runWriter,{migrateExactPlan:identity=>lifecycle.migrateExactPlan(identity),readDiagnosticLedger:identity=>lifecycle.readDiagnosticLedger(identity),recordMigrationCompletion:(identity,stage,receipt)=>lifecycle.recordMigrationCompletion(identity,stage,receipt)}),activation,
 replayPreholdRecovery:preholdRecoveryArtifactAudit(v.recoveryAudit.verifier,v.toolRevision,v.recoveryAudit.evidenceSha256,runFixedPython),
 verifyCandidateAcceptance:async identity=>{if(!same(identity,plan.identity))throw Error('ACCEPTANCE_IDENTITY');const c=await activation.verifyCanonical();if(c.status!=='passed'||c.lockRetained!==true||c.passedStages!==8)throw Error('CANDIDATE_CANONICAL_REJECTED');const b=await activation.runBrowserSmoke();if(Object.values(b).length!==6||Object.values(b).some(v=>v!==true))throw Error('CANDIDATE_BROWSER_REJECTED');},
 collector:v.dynamic.collector,preactivateVerifier:v.dynamic.verifier,readValidatedReceipt:readProductionValidatedReceipt,runBash:runFixedBash,release:v.dynamic.release,assertProtectedInputs:async()=>{for(const c of commands)verify(c);}};
 return {host,inputs,run:runWriter,acquireLock:async()=>{const release=await io.acquireLock();return async()=>{if(started)await lifecycle.closeAfterAccepted();await release();};},retainUnknown:()=>lifecycle.retainUnknown()};
 }catch(error){lifecycle.retainUnknown();throw error;}
}
