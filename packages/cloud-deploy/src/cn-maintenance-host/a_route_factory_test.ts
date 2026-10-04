import test from 'node:test';
import assert from 'node:assert/strict';
import { createARouteFactory, type ARouteFactoryInputs, type ARouteFactoryConsumers, type CurrentEpochEvidence } from './a_route_factory';
import { runARouteMaintenanceRelease } from './a_route';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'factory-local'};
const generation='b'.repeat(32), revision='c'.repeat(40), h='d'.repeat(64);
const request={...identity,maintenanceOptIn:'stop-all-writes-and-require-database-recovery' as const};
const privateRoot=`/etc/workspacex-cn/maintenance-epoch/${identity.sourceRevision}/${identity.attemptId}`;
const ref=(path:string)=>({path,sha256:h});
function fixture(){
 const calls:string[]=[];let state='absent',g=generation;
 const hold={path:'/usr/local/lib/workspacex-cn/cn_maintenance_hold.py',sha256:h};
 const binding={identity,writerPlanPath:'/etc/workspacex-cn/writer.json',writerPlanSha256:h,writerPlanCanonicalSha256:h,hold,writerFence:{path:'/usr/local/lib/workspacex-cn/host_transport.py',sha256:h}};
 const epoch:CurrentEpochEvidence={schemaVersion:1,kind:'held-current-epoch-evidence',identity,toolRevision:revision,holdGeneration:generation,
  epoch:ref(privateRoot+'/epoch.json'),databases:{workspacex:ref(privateRoot+'/api.json'),workspacex_agent:ref(privateRoot+'/agent.json'),workspacex_memory:ref(privateRoot+'/memory.json')},objectRecovery:ref(privateRoot+'/objects.json'),beforeHeldObservationSha256:h,afterHeldObservationSha256:h};
 const completion={identity,toolRevision:revision,holdGeneration:generation,epochSha256:h,completion:ref(`/etc/workspacex-cn/migration-completion-inputs/${identity.sourceRevision}/${identity.attemptId}.completed.json`)};
 const candidate={...completion,reference:ref(`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`)};
 const installed:Record<string,string>={[hold.path]:h};
 function source(name:string){const path=`/usr/local/lib/workspacex-cn/${name}.py`;installed[path]=h;return {binding:{identity,toolRevision:revision,source:{path,sha256:h},inputRefs:[ref('/etc/workspacex-cn/'+name+'.json')]},assertCapability:async()=>{calls.push('admit:'+name);}};}
 const lifecycle={
  start:async()=>{calls.push('writer:start');return {...binding,writerPlanPath:'/etc/workspacex-cn/sealed-writer.json'};},
  invoke:async(callback:string)=>{calls.push('writer:'+callback);return {stdout:JSON.stringify(callback==='verifyWritesBlocked'?{schemaVersion:1,kind:'maintenance-writers-held',identity,ready:false,holdGeneration:g,planSha256:h,observationSha256:h,observedAt:Date.now()/1000}:{callback,identity,ready:false})};},
  bindCandidateReference:async()=>{calls.push('candidate:bind');},
  candidateOperation:async(_identity:MaintenanceIdentity,action:string)=>{calls.push(action==='prepare-resume-intent'?'candidate:intent':'candidate:'+action);},
  baselineCancellation:async(_identity:MaintenanceIdentity,action:string)=>{calls.push('baseline:'+action);},
  closeAfterAccepted:async()=>{calls.push('writer:close');},retainUnknown:()=>{calls.push('writer:retain');},
 };
 const consumers:ARouteFactoryConsumers={
  offline:{...source('offline'),prepare:async()=>{calls.push('prepare');}},
  prehold:{...source('prehold'),verifyRecoveryCapability:async()=>{calls.push('prehold:recovery');},verifyIsolatedAcceptance:async()=>{calls.push('prehold:isolated');}},
  epoch:{...source('epoch'),captureAndVerify:async()=>{calls.push('epoch:capture');return structuredClone(epoch);},verifyCurrentEpochIsolatedAcceptance:async()=>{calls.push('epoch:isolated');}},
  migration:{...source('migration'),migrateExactPlan:async()=>{calls.push('migration');return structuredClone(completion);}},
  heldReadback:{...source('heldReadback'),verify:async()=>{calls.push('held:readback');}},
  candidate:{...source('candidate'),stageAndSeal:async()=>{calls.push('candidate:stage');return structuredClone(candidate);}},
  writer:{...source('writer'),lifecycle},
  public:{...source('public'),bindingPolicy:{identity,deploymentMarker:'local-deployment',observationSamples:2,maximumOutstandingRuns:0},transport:{
   readPublicIdentity:async()=>{calls.push('public:identity');return {sourceRevision:identity.sourceRevision,deploymentMarker:'local-deployment',trustworthy:true};},
   verifyCanonical:async()=>{calls.push('public:canonical');return {status:'passed',lockRetained:true,passedStages:8};},
   runBrowserSmoke:async()=>{calls.push('public:browser');return {login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true};},
   readObservation:async()=>{calls.push('public:observe');return {identity,deploymentMarker:'local-deployment',holdPresent:false,queued:0,running:0,writebackPending:0,failedOwnedRuns:0,unhealthyServices:0};},
  }},
  disposition:{...source('disposition'),recordRecoveryRequired:async()=>{calls.push('recovery:record');},recordReconciliationRequired:async()=>{calls.push('reconciliation:record');}},
 };
 const input:ARouteFactoryInputs={binding,toolRevision:revision,installedFilesSha256:installed,consumers,
  run:async(_command,args)=>{calls.push('hold:'+args[0]);if(args[0]==='create')state='held';if(args[0]==='clear')state='cleared';return {stdout:JSON.stringify({schemaVersion:1,state,identity,generation:g,sha256:h,device:1,inode:2})};},
  readEvidence:async reference=>{calls.push('evidence:read');if(reference.path===epoch.epoch.path){const {epoch:_ref,kind:_kind,...contents}=epoch;return {...structuredClone(contents),kind:'held-current-epoch-manifest'};}if(reference.path===completion.completion.path)return {schemaVersion:1,kind:'validated-migration-completion',identity,toolRevision:revision};if(reference.path===candidate.reference.path)return {schemaVersion:1,toolRevision:revision,plan:{identity,holdGeneration:generation,epoch:h,migrationCompletionSha256:h,artifactSha256:h},artifact:ref('/etc/workspacex-cn/candidate-artifact.json')};throw Error('missing local proof');},
  acquireReleaseLock:async()=>{calls.push('lock');return async()=>{calls.push('unlock');};},assertInstalledSource:async()=>{calls.push('source:verify');},
 };
 return {input,calls,epoch,completion,candidate,setGeneration:(value:string)=>{g=value;}};
}
test('factory composes source producers, late candidate binding, durable intent and both opened observations',async()=>{
 const f=fixture();await runARouteMaintenanceRelease(request,await createARouteFactory(f.input));
 for(const [before,after] of [['epoch:capture','epoch:isolated'],['epoch:isolated','migration'],['migration','held:readback'],['held:readback','candidate:stage'],['candidate:stage','candidate:bind'],['candidate:bind','candidate:verify-staging'],['candidate:intent','candidate:resume'],['candidate:verify-resumed','public:browser']] as const)assert.ok(f.calls.indexOf(before)<f.calls.indexOf(after));
 const opened=f.calls.flatMap((v,index)=>v==='candidate:observe-opened'?[index]:[]),publicSamples=f.calls.flatMap((v,index)=>v==='public:observe'?[index]:[]);
 assert.equal(opened.length,2);assert.equal(publicSamples.length,2);assert.ok(opened[0]!<publicSamples[0]!);assert.ok(opened[1]!>publicSamples[1]!);
 assert.deepEqual(f.calls.slice(-2),['writer:close','unlock']);
});
test('missing epoch producer and late candidate binder fail before any admission, lock or hold',async()=>{
 const f=fixture();delete (f.input.consumers.epoch as any).captureAndVerify;delete (f.input.consumers.writer.lifecycle as any).bindCandidateReference;
 await assert.rejects(createARouteFactory(f.input),/A_ROUTE_FACTORY_CONSUMERS_MISSING:epoch.captureAndVerify,writer.lifecycle.bindCandidateReference/);assert.deepEqual(f.calls,[]);
});
test('plan readiness booleans cannot supply executable producer capability',async()=>{
 const f=fixture();(f.input.consumers.epoch as any).captureAndVerify={qualified:true,ready:true};
 await assert.rejects(createARouteFactory(f.input),/epoch.captureAndVerify/);assert.deepEqual(f.calls,[]);
});
test('foreign consumer identity and profile hash fail before lock and mutation',async()=>{
 for(const corrupt of [(f:ReturnType<typeof fixture>)=>{f.input.consumers.epoch.binding={...f.input.consumers.epoch.binding,identity:{...identity,attemptId:'other'}};},(f:ReturnType<typeof fixture>)=>{(f.input.installedFilesSha256 as any)[f.input.consumers.candidate.binding.source.path]='f'.repeat(64);}]){
  const f=fixture();corrupt(f);await assert.rejects(createARouteFactory(f.input),/A_ROUTE_FACTORY_(CONSUMER_IDENTITY|PROFILE_BINDING)/);assert.deepEqual(f.calls,[]);
 }
});
test('missing public observation capability cannot bypass actual host opened observation',async()=>{
 const f=fixture();delete (f.input.consumers.public.transport as any).readObservation;
 await assert.rejects(createARouteFactory(f.input),/public.transport.readObservation/);assert.deepEqual(f.calls,[]);
});
test('old epoch rejects before migration and invokes only pre-DDL cancellation',async()=>{
 const f=fixture();f.epoch.holdGeneration='f'.repeat(32);
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/EPOCH_IDENTITY/);
 assert.equal(f.calls.includes('migration'),false);assert.ok(f.calls.includes('baseline:resume-baseline'));assert.equal(f.calls.includes('candidate:resume'),false);
});
test('hold generation changing during capture rejects even matching producer receipt',async()=>{
 const f=fixture();f.input.consumers.epoch.captureAndVerify=async()=>{f.setGeneration('f'.repeat(32));return structuredClone(f.epoch);};
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/WRITE_STATE_RECONCILIATION/);assert.equal(f.calls.includes('migration'),false);assert.equal(f.calls.includes('unlock'),false);
});
test('missing object evidence cannot authorize epoch acceptance or SQL',async()=>{
 const f=fixture();delete (f.epoch as any).objectRecovery;
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)));assert.equal(f.calls.includes('epoch:isolated'),false);assert.equal(f.calls.includes('migration'),false);
});
test('completion from another epoch causes database recovery disposition without prior resume',async()=>{
 const f=fixture();f.completion.epochSha256='f'.repeat(64);
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/DATABASE_RECOVERY_REQUIRED/);
 assert.ok(f.calls.includes('recovery:record'));assert.equal(f.calls.includes('baseline:resume-baseline'),false);assert.equal(f.calls.includes('unlock'),false);
});
test('candidate binding mismatch is never passed to retained actor',async()=>{
 const f=fixture();f.candidate.completion=ref('/etc/workspacex-cn/foreign.completed.json');
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/DATABASE_RECOVERY_REQUIRED/);assert.equal(f.calls.includes('candidate:bind'),false);assert.equal(f.calls.includes('candidate:resume'),false);
});
test('direct consumer use cannot stage before migration or resume before durable intent',async()=>{
 const f=fixture();const ops=await createARouteFactory(f.input);
 await assert.rejects(ops.stageCandidateRuntime(identity),/CANDIDATE_STAGE_ORDER/);await assert.rejects(ops.resumeExactCandidateWriters(identity),/RESUME_WITHOUT_INTENT/);
 assert.equal(f.calls.includes('candidate:stage'),false);assert.equal(f.calls.includes('candidate:resume'),false);
});
test('post-open public failure reholds and uses close-only rebind/block without baseline resume',async()=>{
 const f=fixture();f.input.consumers.public.transport.readObservation=async()=>{throw Error('opened failure');};
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/DATABASE_RECOVERY_REQUIRED/);
 assert.ok(f.calls.includes('candidate:rebind-held-epoch-for-reblock'));assert.ok(f.calls.includes('candidate:block'));assert.ok(f.calls.includes('candidate:verify-blocked'));
 assert.equal(f.calls.includes('baseline:resume-baseline'),false);assert.equal(f.calls.includes('unlock'),false);
});
test('capability rejection retains legacy hard admission boundary before lock',async()=>{
 const f=fixture();f.input.consumers.epoch.assertCapability=async()=>{throw Error('CURRENT_EPOCH_SOURCE_NOT_IMPLEMENTED');};
 await assert.rejects(createARouteFactory(f.input),/CURRENT_EPOCH_SOURCE_NOT_IMPLEMENTED/);assert.equal(f.calls.includes('lock'),false);assert.equal(f.calls.some(v=>v.startsWith('hold:')),false);
});
test('producer callback snapshot survives implementation replacement during protected admission',async()=>{
 const f=fixture();f.input.assertInstalledSource=async()=>{f.input.consumers.epoch.captureAndVerify=async()=>{throw Error('replaced');};};
 await runARouteMaintenanceRelease(request,await createARouteFactory(f.input));assert.ok(f.calls.includes('epoch:capture'));
});

test('producer returning a reference without matching persisted epoch cannot authorize SQL',async()=>{
 const f=fixture();f.input.readEvidence=async()=>({qualified:true,ready:true});
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/EPOCH_FILE_BINDING/);assert.equal(f.calls.includes('migration'),false);
});
test('wrong persisted candidate identity prevents binding and write resumption',async()=>{
 const f=fixture();const read=f.input.readEvidence;f.input.readEvidence=async reference=>reference.path===f.candidate.reference.path?{schemaVersion:1,toolRevision:revision,plan:{identity:{...identity,attemptId:'other'},holdGeneration:generation,epoch:h,migrationCompletionSha256:h,artifactSha256:h},artifact:ref('/etc/workspacex-cn/candidate-artifact.json')}:read(reference);
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/DATABASE_RECOVERY_REQUIRED/);assert.equal(f.calls.includes('candidate:bind'),false);assert.equal(f.calls.includes('candidate:resume'),false);
});

for(const [name,corrupt] of [
 ['missing artifact',(value:any)=>{delete value.artifact;}],
 ['extra wrapper field',(value:any)=>{value.ready=true;}],
 ['artifact hash mismatch',(value:any)=>{value.artifact.sha256='f'.repeat(64);} ],
 ['extra artifact field',(value:any)=>{value.artifact.bytes=1;}],
 ['missing plan artifact hash',(value:any)=>{delete value.plan.artifactSha256;}],
] as const)test('strict candidate wrapper rejects '+name+' before binding/resume',async()=>{
 const f=fixture();const read=f.input.readEvidence;
 f.input.readEvidence=async reference=>{const value:any=await read(reference);if(reference.path===f.candidate.reference.path)corrupt(value);return value;};
 await assert.rejects(runARouteMaintenanceRelease(request,await createARouteFactory(f.input)),/DATABASE_RECOVERY_REQUIRED/);
 assert.equal(f.calls.includes('candidate:bind'),false);assert.equal(f.calls.includes('candidate:resume'),false);
 assert.equal(f.calls.includes('unlock'),false);assert.ok(f.calls.includes('recovery:record'));
});
