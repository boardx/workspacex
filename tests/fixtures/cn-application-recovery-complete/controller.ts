/** Isolated source-owned driver. Production CLIs cannot select this composition. */
import {spawn,type ChildProcess} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createARouteFactory,type ARouteFactoryInputs} from '../../../packages/cloud-deploy/src/cn-maintenance-host/a_route_factory';
import {runARouteMaintenanceRelease} from '../../../packages/cloud-deploy/src/cn-maintenance-host/a_route';
import {originalAuthorityFixture} from '../../../packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority_test_fixture';
import {assertSourcePlanAuthority} from '../../../packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority';
import {createHash} from 'node:crypto';
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function trackFixtureActor(child:ChildProcess){
 let spawnFailed=false,runtimeError=false;
 const completed=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>{spawnFailed=child.pid===undefined;runtimeError=!spawnFailed;resolve();});});
 return async()=>{const alive=()=>!spawnFailed&&child.exitCode===null&&child.signalCode===null;
  const timer=alive()?setTimeout(()=>child.kill('SIGKILL'),2000):undefined;
  try{await completed;if(runtimeError)throw Error('ACTOR_EXIT_UNPROVEN');}finally{if(timer)clearTimeout(timer);}
 };
}

export async function withCompleteController(root:string,python:string,hooks:{held:()=>Promise<void>;capture:()=>Promise<string>;rehearse:()=>Promise<void>;migrate:()=>Promise<void>;readback:()=>Promise<void>},drift=false){
 if(!/^\/tmp\/wsx-postclear-[a-f0-9]{32}$/.test(root)||!python.startsWith('/'))throw Error('ISOLATED_DRIVER_REQUIRED');
 const child=spawn(python,['-B',fileURLToPath(new URL('../cn-postclear-recovery/candidate_actor.py',import.meta.url)),root],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'}});
 const stopActor=trackFixtureActor(child);child.stdin.on('error',()=>{});
 child.stderr.resume();const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();
 const receive=async()=>{let timer:NodeJS.Timeout;try{return await Promise.race([iterator.next().then(r=>{if(r.done)throw Error('ACTOR_EOF');return JSON.parse(r.value);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('ACTOR_DEADLINE')),10000);})]);}finally{clearTimeout(timer!);}};
 const rpc=async(action:string,data?:unknown)=>{child.stdin.write(JSON.stringify({action,...(data===undefined?{}:{data})})+'\n');const r=await receive();if(!r.ok){console.error('isolated actor rejection',action,r.code);throw Error('ACTOR_'+r.code);}return r.value;};
 try{
  const hello=await receive(),identity=hello.identity,tool='0'.repeat(40),h='e'.repeat(64);let g=hello.oldGeneration,created=false;
  const {authority,host}=originalAuthorityFixture(identity,tool);let disposition='',released=false,opened=false,migrated=false;const events:string[]=[];
  const assertAuthority=async()=>{assertSourcePlanAuthority(authority,identity,tool);};
  const installed:Record<string,string>={[host.hold.path]:host.hold.sha256};
  const ref=(path:string)=>({path,sha256:h});
  const common=(name:string)=>{const path='/usr/local/lib/workspacex-cn/'+name+'.py';installed[path]=h;return{binding:{identity,toolRevision:tool,source:{path,sha256:h},inputRefs:[ref('/etc/workspacex-cn/'+name+'.json')]},assertCapability:assertAuthority};};
  const epoch={schemaVersion:1 as const,kind:'held-current-epoch-evidence' as const,identity,toolRevision:tool,holdGeneration:g,epoch:ref(`/etc/workspacex-cn/maintenance-evidence/${identity.sourceRevision}/${identity.attemptId}/qualified-current-epoch/epoch.json`),databases:{workspacex:ref('/etc/workspacex-cn/api.json'),workspacex_agent:ref('/etc/workspacex-cn/agent.json'),workspacex_memory:ref('/etc/workspacex-cn/memory.json')},objectRecovery:ref('/etc/workspacex-cn/objects.json'),beforeHeldObservationSha256:h,afterHeldObservationSha256:h};
  const completion={identity,toolRevision:tool,holdGeneration:g,epochSha256:h,completion:ref(`/etc/workspacex-cn/migration-completion-inputs/${identity.sourceRevision}/${identity.attemptId}.completed.json`)};
  const candidate={...completion,reference:ref(`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`)};
  const lifecycle={start:async()=>host,invoke:async(callback:string)=>{await hooks.held();await rpc('lock');const hold=await rpc('read');return{stdout:JSON.stringify({schemaVersion:1,kind:'maintenance-writers-held',identity,ready:false,holdGeneration:hold.generation,planSha256:host.writerPlanCanonicalSha256,observationSha256:h,observedAt:Date.now()/1000})};},bindCandidateReference:async()=>{},candidateOperation:async(_id:unknown,action:string)=>{await rpc(action);},baselineCancellation:async()=>{throw Error('BASELINE_RESTORE_FORBIDDEN');},closeAfterAccepted:async()=>{const actual=await rpc('state');if(actual.hold.state!=='cleared'||!actual.running)throw Error('ACTUAL_CLEAR_REQUIRED');events.push('close');},retainUnknown:()=>{}};
  const input:ARouteFactoryInputs={binding:host,toolRevision:tool,installedFilesSha256:installed,
   acquireReleaseLock:async()=>{await rpc('lock');return async()=>{released=true;};},assertInstalledSource:assertAuthority,
   run:async(_cmd,args,data)=>{const value=await rpc(args[0]!,data);if(args[0]==='create'&&!created){created=true;g=value.generation;epoch.holdGeneration=g;completion.holdGeneration=g;candidate.holdGeneration=g;}return{stdout:JSON.stringify(value)};},
   readEvidence:async r=>{if(r.path===epoch.epoch.path){const{epoch:_ref,kind:_kind,...rest}=epoch;return{...rest,kind:'held-current-epoch-manifest'};}if(r.path===completion.completion.path)return{...hello.completion,capturedAt:new Date().toISOString(),providerFinishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};if(r.path===candidate.reference.path)return{schemaVersion:1,toolRevision:tool,plan:{identity,holdGeneration:g,epoch:epoch.epoch.sha256,migrationCompletionSha256:h,artifactSha256:h},artifact:ref('/etc/workspacex-cn/artifact.json')};throw Error('FIXTURE_EVIDENCE_MISSING');},
   consumers:{offline:{...common('offline'),prepare:async()=>{}},prehold:{...common('prehold'),verifyRecoveryCapability:async()=>{},verifyIsolatedAcceptance:async()=>{}},epoch:{...common('epoch'),captureAndVerify:async()=>{const dump=await hooks.capture();if(!/^[a-f0-9]{64}$/.test(dump))throw Error('ACTUAL_DUMP_REQUIRED');epoch.epoch.sha256=dump;completion.epochSha256=dump;candidate.epochSha256=dump;events.push('backup');if(drift){const old=await rpc('read');await rpc('clear',old);await rpc('create');}return epoch;},verifyCurrentEpochIsolatedAcceptance:async()=>{await hooks.rehearse();events.push('rehearsal');}},migration:{...common('migration'),migrateExactPlan:async()=>{await hooks.migrate();migrated=true;events.push('migrate');return completion;}},heldReadback:{...common('held'),verify:async()=>{await hooks.readback();events.push('readback');}},candidate:{...common('candidate'),stageAndSeal:async()=>candidate},writer:{...common('writer'),lifecycle},public:{...common('public'),bindingPolicy:{identity,deploymentMarker:'fixture',observationSamples:2,maximumOutstandingRuns:0},transport:{readPublicIdentity:async()=>({sourceRevision:identity.sourceRevision,deploymentMarker:'fixture',trustworthy:true}),verifyCanonical:async()=>({status:'passed',lockRetained:true,passedStages:8}),runBrowserSmoke:async()=>({login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true}),readObservation:async()=>{opened=true;return{identity,deploymentMarker:'fixture',holdPresent:false,queued:0,running:0,writebackPending:0,failedOwnedRuns:0,unhealthyServices:0};}}},disposition:{...common('disposition'),recordRecoveryRequired:async()=>{disposition='recovery';},recordReconciliationRequired:async()=>{disposition='unknown';}}}
  };
  let failure='';try{await runARouteMaintenanceRelease({...identity,maintenanceOptIn:'stop-all-writes-and-require-database-recovery'},await createARouteFactory(input));}catch(e){failure=String(e);}
  const state=await rpc('state');
  if(drift){if(!failure.includes('WRITE_STATE_RECONCILIATION')||migrated||released||state.hold.state!=='held'||state.hold.generation===g)throw Error('FRESH_HOLD_NOT_REJECTED');}
  else{if(failure||!opened||!migrated||!released||state.hold.state!=='cleared'||state.hold.generation!==g)throw Error('COMPLETE_ORIGINAL_ROUTE_REQUIRED:'+failure);if(events.join(',')!=='backup,rehearsal,migrate,readback,close')throw Error('ACTUAL_DB_OPERATION_ORDER');}
  return{kind:'isolated-real-database-a-route-v1',events,holdGeneration:g,finalHold:state.hold,originalARouteFactory:true,originalHoldStore:true,databaseHooksInvoked:true,holdDriftRejected:drift,providerCompletionFixture:true,writerTransportFixture:true,browserFixture:true,productionAccepted:false};
 }finally{
  child.stdin.end();lines.close();
  await stopActor();
 }
}
