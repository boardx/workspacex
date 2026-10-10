import {admittedReleaseIdentity} from './release_identity';
import {readOriginalPlanAuthority,assertSourcePlanAuthority} from './source_plan_authority';
/** Fixed 9b source composition. Root inputs contain only protected data refs;
 * all executable operations are assembled here, never from a JSON registry. */
import {z} from 'zod';
import {closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {EntryPlan} from './entry';
import {protectedPrivateJson,protectedPrivateBytes,protectedExecutable,runFixedPython,inheritedFd9Lock,type TrustedExecutable,type CommandRunner} from './fixed_transport';
import {createPersistentWriterLifecycle,persistentSourceModules,runtimeDigest,type MaintenanceSourceAction} from './sealed_runtime';
import {createARouteFactory,type CurrentEpochEvidence,type FactoryRef} from './a_route_factory';
import {consumePreholdEpochManifest,type QualifiedCurrentEpochSourcePolicy} from './current_epoch_manifest_consumer';
import {verifyOfflineManifest} from './offline_artifacts';
import {maintenanceOfflinePreparedAction} from './activation_transport';
import {createMigrationTransport,type MigrationHostBinding} from './migration_transport';
import {exactMigrationAction,type ExactMigrationInputs} from './reused_actions';
import type {ProtectedOperationInputs} from './typed_operations';
import {readNativeCompletion,readApprovedCompletionRelease} from './native_completion';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const ref=z.object({path:z.string().startsWith('/etc/workspacex-cn/').refine(v=>!v.split('/').includes('..')),sha256:hash}).strict();
const command=z.object({path:z.string().startsWith('/usr/local/lib/workspacex-cn/'),sha256:hash}).strict();
const schema=z.object({schemaVersion:z.literal(2),identity:z.object({sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),baselineRevision:z.string().regex(/^[a-f0-9]{40}$/),migrationPlanSha256:hash,attemptId:z.string().regex(/^[A-Za-z0-9-]{1,32}$/)}).strict(),toolRevision:z.string().regex(/^[a-f0-9]{40}$/),
 prepared:z.object({receipt:ref,manifest:ref}).strict(),migration:z.object({inputs:ref,binding:z.unknown()}).strict(),
 writerModules:z.object({writer_fence:command,fixed_probes:command,control_connection:command}).strict(),
 candidateModules:z.object({candidate_writer:command,candidate_backend_collector:command,candidate_host_transport:command}).strict(),
 sourceOperationModules:z.record(command),prehold:z.unknown(),dockerRuntime:z.object({path:z.literal('/usr/bin/docker'),sha256:hash}).strict(),
 publicPolicy:z.object({deploymentMarker:z.string().min(1),observationSamples:z.number().int().min(2).max(60),maximumOutstandingRuns:z.number().int().nonnegative().safe()}).strict()}).strict();
const need=(ok:unknown,code:string):void=>{if(!ok)throw Error(code);};
const same=(a:unknown,b:unknown)=>runtimeDigest(a)===runtimeDigest(b);
/** Source fixture substitutions are not consumer-input fields. */
export interface SourceConsumerRuntime {
 readJson:typeof protectedPrivateJson;readBytes:typeof protectedPrivateBytes;
 verifyExecutable:(command:TrustedExecutable)=>void;
 lifecycle:typeof createPersistentWriterLifecycle;migration:typeof createMigrationTransport;
 run:CommandRunner;acquireLock:typeof inheritedFd9Lock;
}
const actual:SourceConsumerRuntime={readJson:protectedPrivateJson,readBytes:protectedPrivateBytes,
 verifyExecutable:c=>{const fd=protectedExecutable(c);closeSync(fd);},lifecycle:createPersistentWriterLifecycle,migration:createMigrationTransport,run:runFixedPython,acquireLock:inheritedFd9Lock};
export async function createSourceProductionConsumers(plan:EntryPlan,profile:any,value:unknown,fixture:Partial<SourceConsumerRuntime>={}){
 const io={...actual,...fixture},v=schema.parse(value),identity=plan.identity,toolRevision=v.toolRevision;
 need(admittedReleaseIdentity(identity)&&same(v.identity,identity)&&toolRevision===plan.production.toolRevision&&profile.toolRevision===toolRevision,'SOURCE_CONSUMER_IDENTITY');
 need(Object.keys(v.sourceOperationModules).sort().join(',')===Object.keys(persistentSourceModules).sort().join(','),'SOURCE_CONSUMER_MODULE_CLOSURE');
 const verify=(c:TrustedExecutable)=>{need(profile.installedFilesSha256?.[c.path]===c.sha256,'SOURCE_CONSUMER_PROFILE_PIN');io.verifyExecutable(c);};
 const all=[plan.host.hold,plan.host.writerFence,...Object.values(v.writerModules),...Object.values(v.candidateModules),...Object.values(v.sourceOperationModules)];
 for(const [name,file] of Object.entries(persistentSourceModules)){
  const c=v.sourceOperationModules[name]!;need(c.path===`/usr/local/lib/workspacex-cn/${file}`&&profile.filesSha256?.[`.harness/scripts/vm/${file}`]===c.sha256,'SOURCE_CONSUMER_SOURCE_CLOSURE');
 }
 for(const [name,c] of Object.entries({...v.writerModules,...v.candidateModules}))need(c.path===`/usr/local/lib/workspacex-cn/${name}.py`,'SOURCE_CONSUMER_MODULE_PATH');
 for(const c of all)verify(c);
 const capability=profile.maintenanceSourceOperations;
 need(capability?.schemaVersion===1&&capability.sourcePath==='.harness/scripts/vm/maintenance_source_operations.py'&&capability.sha256===v.sourceOperationModules.maintenance_source_operations!.sha256&&capability.inputs&&typeof capability.inputs==='object'&&!Array.isArray(capability.inputs),'SOURCE_OPERATION_CAPABILITY');
 need(profile.parentCaptureInvocation?.schemaVersion===1&&typeof profile.parentCaptureInvocation.producerId==='string'&&profile.parentCaptureInvocation.executablePins,'SOURCE_CAPTURE_CAPABILITY');
 need(profile.currentEpochQualification?.schemaVersion===2&&profile.currentEpochQualification.sourcePath==='.harness/scripts/vm/current_epoch_qualification.py'&&profile.currentEpochQualification.sha256===v.sourceOperationModules.current_epoch_qualification!.sha256,'SOURCE_QUALIFICATION_CAPABILITY');
 const prehold=v.prehold as QualifiedCurrentEpochSourcePolicy;
 need(prehold&&same(prehold.filesSha256,profile.filesSha256),'SOURCE_PREHOLD_SOURCE_POLICY');
 const migrationInputs=io.readJson(v.migration.inputs.path,v.migration.inputs.sha256) as ExactMigrationInputs;
 const migrationBinding=v.migration.binding as MigrationHostBinding;
 need(same(migrationBinding?.identity,identity)&&migrationBinding.toolRevision===toolRevision,'SOURCE_MIGRATION_BINDING');verify(migrationBinding.collector);
 const authority=readOriginalPlanAuthority(plan.host,toolRevision,profile,io.readBytes);
 const approvedRelease=()=>readApprovedCompletionRelease(authority,io.readBytes);
 approvedRelease();
 const sourcePlan=authority.sourcePlan;
 const lifecycle=io.lifecycle({identity,toolRevision,sourcePlanPath:plan.host.writerPlanPath,sourcePlanSha256:plan.host.writerPlanSha256,sourcePlan,host:plan.host,modules:v.writerModules,candidate:{modules:v.candidateModules},sourceOperationModules:v.sourceOperationModules});
 const boundMigration={...migrationBinding};let heldHost:import('./controller').HostBinding|undefined;
 const start=lifecycle.start.bind(lifecycle);
 lifecycle.start=async()=>{heldHost=await start();Object.assign(boundMigration,{writerPlanPath:heldHost.writerPlanPath,writerPlanSha256:heldHost.writerPlanSha256,writerPlanCanonicalSha256:heldHost.writerPlanCanonicalSha256});return heldHost;};
 const runWriter:CommandRunner=async(c,args,input)=>{
  if(c.path!==plan.host.writerFence.path)return io.run(c,args,input);
  need(heldHost&&args.length===4&&args[0]==='--apply-reviewed-fence'&&args[1]===heldHost!.writerPlanPath&&args[2]===heldHost!.writerPlanSha256&&args[3]==='verifyWritesBlocked','SOURCE_PERSISTENT_WRITER_ROUTING');
  return lifecycle.invoke('verifyWritesBlocked',identity);
 };
 const transport=io.migration(migrationInputs,boundMigration,runWriter,{migrateExactPlan:id=>lifecycle.migrateExactPlan(id),readDiagnosticLedger:id=>lifecycle.readDiagnosticLedger(id),recordMigrationCompletion:(id,stage,receipt)=>lifecycle.recordMigrationCompletion(id,stage,receipt)},undefined,authority);
 const operationSource=v.sourceOperationModules.maintenance_source_operations!;
 const op=async(action:MaintenanceSourceAction)=>{
  assertSourcePlanAuthority(authority,identity,toolRevision);
  const live=io.readJson('/etc/workspacex-cn/trusted-tool-binding.json') as any;
  need(live.toolRevision===toolRevision&&same(live.filesSha256,profile.filesSha256)&&same(live.installedFilesSha256,profile.installedFilesSha256),'SOURCE_OPERATION_AUTHORITY_CHANGED');
  const r=ref.parse(live.maintenanceSourceOperations?.inputs?.[action]);
  return lifecycle.sourceOperation(identity,action,r) as Promise<any>;
 };
 const common=(source:TrustedExecutable)=>({binding:{identity,toolRevision,source,inputRefs:[{path:plan.consumerInputsPath,sha256:plan.consumerInputsSha256}]},assertCapability:async()=>{all.forEach(verify);}});
 let archived:CurrentEpochEvidence|undefined,current:CurrentEpochEvidence|undefined;
 const manifest=io.readBytes(v.prepared.manifest.path,v.prepared.manifest.sha256);
 const offline=maintenanceOfflinePreparedAction(io.readJson(v.prepared.receipt.path,v.prepared.receipt.sha256),manifest,verifyOfflineManifest(identity,manifest,v.prepared.manifest.sha256,v.dockerRuntime));
 const readReceipt=(value:any,lane:'canonical'|'browser')=>{
  const r=ref.parse(value.receipt);need(r.path===`/etc/workspacex-cn/maintenance-acceptance/${identity.sourceRevision}/${identity.attemptId}/${lane}.json`,'SOURCE_ACCEPTANCE_RECEIPT_PATH');
  const receipt=io.readJson(r.path,r.sha256) as any;
  need(receipt?.schemaVersion===1&&receipt.kind===lane+'-acceptance-completed'&&same(receipt.identity,identity)&&receipt.deploymentMarker===v.publicPolicy.deploymentMarker,'SOURCE_ACCEPTANCE_RECEIPT_BINDING');return receipt.checks;
 };
 try{
 const route=await createARouteFactory({binding:plan.host,toolRevision,installedFilesSha256:profile.installedFilesSha256,run:io.run,
  acquireReleaseLock:async()=>{const release=await io.acquireLock();return async()=>{await release();};},assertInstalledSource:async c=>verify(c),readEvidence:async r=>io.readJson(r.path,r.sha256),consumers:{
  offline:{...common(operationSource),prepare:offline},
  prehold:{...common(prehold.qualificationExecutable),verifyRecoveryCapability:async()=>{archived=await consumePreholdEpochManifest(prehold,{read:async r=>io.readJson(r.path,r.sha256),run:io.run},authority);},verifyIsolatedAcceptance:async()=>{need(archived,'SOURCE_PREHOLD_NOT_VERIFIED');await consumePreholdEpochManifest(prehold,{read:async r=>io.readJson(r.path,r.sha256),run:io.run},authority);}},
  epoch:{...common(operationSource),captureAndVerify:async()=>{await op('capture-current-epoch-draft');await op('stage-epoch-external-evidence');await op('finalize-epoch-input');current=await op('qualify-current-epoch');return current!;},verifyCurrentEpochIsolatedAcceptance:async(_id,e)=>{need(same(await op('verify-qualified-current-epoch'),e),'SOURCE_CURRENT_EPOCH_RECHECK');}},
  migration:{...common(migrationBinding.collector),approvedRelease,migrateExactPlan:async(id,e)=>{await exactMigrationAction(migrationInputs,transport)(id);const path=boundMigration.completionPath.replace(/\.json$/,'.completed.json');const bytes=io.readBytes(path);readNativeCompletion(JSON.parse(bytes.toString('utf8')),id,Date.now(),approvedRelease());return {identity,toolRevision,holdGeneration:e.holdGeneration,epochSha256:e.epoch.sha256,completion:{path,sha256:createHash('sha256').update(bytes).digest('hex')}};}},
  heldReadback:{...common(operationSource),verify:async()=>{await op('held-candidate-readback');}},
  candidate:{...common(operationSource),stageAndSeal:async(_id,_host,e,c)=>{const result=await op('stage-candidate-and-seal');return {...c,reference:ref.parse(result.reference)};}},
  writer:{...common(plan.host.writerFence),lifecycle},
  public:{...common(operationSource),bindingPolicy:{identity,...v.publicPolicy},transport:{readPublicIdentity:()=>op('read-public-candidate-identity'),verifyCanonical:async()=>readReceipt(await op('canonical-candidate-acceptance'),'canonical'),runBrowserSmoke:async()=>readReceipt(await op('browser-candidate-acceptance'),'browser'),readObservation:()=>op('observe-opened-candidate')}},
  disposition:{...common(plan.host.writerFence),recordRecoveryRequired:async id=>{await lifecycle.invoke('recordDatabaseRecoveryRequired',id);},recordReconciliationRequired:async id=>{await lifecycle.invoke('recordWriteStateReconciliationRequired',id);}},
 }});
 const inputs:Partial<ProtectedOperationInputs>={admittedARoute:route,assertProtectedInputs:async()=>{all.forEach(verify);}};
 return {host:plan.host,inputs,run:runWriter,acquireLock:io.acquireLock,retainUnknown:()=>lifecycle.retainUnknown()};
 }catch(error){lifecycle.retainUnknown();throw error;}
}
