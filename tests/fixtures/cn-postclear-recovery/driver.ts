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
const reheldContexts=new WeakMap<object,()=>Promise<void>>();
export async function assertReheldContext(context:any){const verify=reheldContexts.get(context);if(!verify)throw Error('ACTUAL_REHELD_CAPABILITY_REQUIRED');await verify();}

export function trackFixtureActor(child:ChildProcess){
 let spawnFailed=false,runtimeError=false;
 const completed=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>{spawnFailed=child.pid===undefined;runtimeError=!spawnFailed;resolve();});});
 return async()=>{const alive=()=>!spawnFailed&&child.exitCode===null&&child.signalCode===null;
  const timer=alive()?setTimeout(()=>child.kill('SIGKILL'),2000):undefined;
  try{await completed;if(runtimeError)throw Error('ACTOR_EXIT_UNPROVEN');}finally{if(timer)clearTimeout(timer);}
 };
}

export async function withReheldController(root:string,python:string,onOpen:()=>Promise<void>,afterBlocked:(context:any)=>Promise<unknown>){
 if(!/^\/tmp\/wsx-postclear-[a-f0-9]{32}$/.test(root)||!python.startsWith('/'))throw Error('ISOLATED_DRIVER_REQUIRED');
 const child=spawn(python,['-B',fileURLToPath(new URL('./candidate_actor.py',import.meta.url)),root],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'}});
 const stopActor=trackFixtureActor(child);child.stdin.on('error',()=>{});
 child.stderr.resume();const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();
 const receive=async()=>{let timer:NodeJS.Timeout;try{return await Promise.race([iterator.next().then(r=>{if(r.done)throw Error('ACTOR_EOF');return JSON.parse(r.value);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('ACTOR_DEADLINE')),10000);})]);}finally{clearTimeout(timer!);}};
 let actorFailure:Error|undefined;
 const rpc=async(action:string,data?:unknown)=>{child.stdin.write(JSON.stringify({action,...(data===undefined?{}:{data})})+'\n');const r=await receive();if(!r.ok){const error=Error('ACTOR_'+r.code);actorFailure??=error;throw error;}return r.value;};
 try{
  const hello=await receive(),identity=hello.identity,tool='0'.repeat(40),h='e'.repeat(64);let g=hello.oldGeneration,created=false;
  const {authority,host}=originalAuthorityFixture(identity,tool);let disposition='',released=false,opened=false;
  const assertAuthority=async()=>{assertSourcePlanAuthority(authority,identity,tool);};
  const installed:Record<string,string>={[host.hold.path]:host.hold.sha256};
  const ref=(path:string)=>({path,sha256:h});
  const common=(name:string)=>{const path='/usr/local/lib/workspacex-cn/'+name+'.py';installed[path]=h;return{binding:{identity,toolRevision:tool,source:{path,sha256:h},inputRefs:[ref('/etc/workspacex-cn/'+name+'.json')]},assertCapability:assertAuthority};};
  const epoch={schemaVersion:1 as const,kind:'held-current-epoch-evidence' as const,identity,toolRevision:tool,holdGeneration:g,epoch:ref(`/etc/workspacex-cn/maintenance-evidence/${identity.sourceRevision}/${identity.attemptId}/qualified-current-epoch/epoch.json`),databases:{workspacex:ref('/etc/workspacex-cn/api.json'),workspacex_agent:ref('/etc/workspacex-cn/agent.json'),workspacex_memory:ref('/etc/workspacex-cn/memory.json')},objectRecovery:ref('/etc/workspacex-cn/objects.json'),beforeHeldObservationSha256:h,afterHeldObservationSha256:h};
  const completion={identity,toolRevision:tool,holdGeneration:g,epochSha256:h,completion:ref(`/etc/workspacex-cn/migration-completion-inputs/${identity.sourceRevision}/${identity.attemptId}.completed.json`)};
  const candidate={...completion,reference:ref(`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`)};
  const lifecycle={start:async()=>host,invoke:async(callback:string)=>{await rpc('lock');const hold=await rpc('read');return{stdout:JSON.stringify({schemaVersion:1,kind:'maintenance-writers-held',identity,ready:false,holdGeneration:hold.generation,planSha256:host.writerPlanCanonicalSha256,observationSha256:h,observedAt:Date.now()/1000})};},bindCandidateReference:async()=>{},candidateOperation:async(_id:unknown,action:string)=>{await rpc(action);},baselineCancellation:async()=>{throw Error('BASELINE_RESTORE_FORBIDDEN');},closeAfterAccepted:async()=>{throw Error('MUST_RETAIN');},retainUnknown:()=>{}};
  const input:ARouteFactoryInputs={binding:host,toolRevision:tool,installedFilesSha256:installed,
   acquireReleaseLock:async()=>{await rpc('lock');return async()=>{released=true;};},assertInstalledSource:assertAuthority,
   run:async(_cmd,args,data)=>{const value=await rpc(args[0]!,data);if(args[0]==='create'&&!created){created=true;g=value.generation;epoch.holdGeneration=g;completion.holdGeneration=g;candidate.holdGeneration=g;}return{stdout:JSON.stringify(value)};},
   readEvidence:async r=>{if(r.path===epoch.epoch.path){const{epoch:_ref,kind:_kind,...rest}=epoch;return{...rest,kind:'held-current-epoch-manifest'};}if(r.path===completion.completion.path)return{...hello.completion,capturedAt:new Date().toISOString(),providerFinishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};if(r.path===candidate.reference.path)return{schemaVersion:1,toolRevision:tool,plan:{identity,holdGeneration:g,epoch:h,migrationCompletionSha256:h,artifactSha256:h},artifact:ref('/etc/workspacex-cn/artifact.json')};throw Error('FIXTURE_EVIDENCE_MISSING');},
   consumers:{offline:{...common('offline'),prepare:async()=>{}},prehold:{...common('prehold'),verifyRecoveryCapability:async()=>{},verifyIsolatedAcceptance:async()=>{}},epoch:{...common('epoch'),captureAndVerify:async()=>epoch,verifyCurrentEpochIsolatedAcceptance:async()=>{}},migration:{...common('migration'),migrateExactPlan:async()=>completion},heldReadback:{...common('held'),verify:async()=>{}},candidate:{...common('candidate'),stageAndSeal:async()=>candidate},writer:{...common('writer'),lifecycle},public:{...common('public'),bindingPolicy:{identity,deploymentMarker:'fixture',observationSamples:2,maximumOutstandingRuns:0},transport:{readPublicIdentity:async()=>({sourceRevision:identity.sourceRevision,deploymentMarker:'fixture',trustworthy:true}),verifyCanonical:async()=>({status:'passed',lockRetained:true,passedStages:8}),runBrowserSmoke:async()=>({login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true}),readObservation:async()=>{await onOpen();opened=true;throw Error('ISOLATED_POSTCLEAR_FAULT');}}},disposition:{...common('disposition'),recordRecoveryRequired:async()=>{disposition='recovery';},recordReconciliationRequired:async()=>{disposition='unknown';}}}
  };
  let failure='',routeFailure:unknown,operationFailure:unknown;
  try{
   const operations=await createARouteFactory(input);
   // Observe the original error before the production catch converts it to a
   // recovery disposition. Rethrow unchanged; never retry or alter an operation.
   for(const name of Object.keys(operations) as Array<keyof typeof operations>){
    const original=operations[name];
    (operations as any)[name]=async(...args:unknown[])=>{try{return await (original as any)(...args);}catch(error){operationFailure??=error;throw error;}};
   }
   await runARouteMaintenanceRelease({...identity,maintenanceOptIn:'stop-all-writes-and-require-database-recovery'},operations);
  }catch(e){routeFailure=e;failure=String(e);}
  if(!opened||!failure.includes('DATABASE_RECOVERY_REQUIRED')||disposition!=='recovery'||released)throw Error('ORIGINAL_CATCH_NOT_COMPLETED',{cause:actorFailure??operationFailure??routeFailure});
  const state=await rpc('state');if(state.running||!state.resumeDisabled||state.hold.state!=='held'||state.hold.generation===g)throw Error('ACTUAL_REBLOCK_REQUIRED');
  await assertAuthority();await rpc('lock');
  const context=Object.freeze({authority,oldGeneration:g,newGeneration:state.hold.generation,eventsSha256:digest(state.events)});
  reheldContexts.set(context,async()=>{await assertAuthority();await rpc('lock');await rpc('verify-blocked');const fresh=await rpc('state');if(fresh.running||!fresh.resumeDisabled||fresh.hold.state!=='held'||fresh.hold.generation!==context.newGeneration)throw Error('REHELD_CAPABILITY_DRIFT');});
  try{return await afterBlocked(context);}finally{reheldContexts.delete(context);}
 }finally{
  child.stdin.end();lines.close();
  await stopActor();
 }
}
