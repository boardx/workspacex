import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, fstatSync } from 'node:fs';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import { protectedPrivateJson, protectedExecutable, pinnedPythonModuleFinder, type TrustedExecutable, type CommandResult } from './fixed_transport';
import { verifyExistingMaintenanceTransport } from './migration_library';
import { writerCallbacks, type HostBinding } from './controller';
export const maintenanceSourceActions=['capture-current-epoch-draft','stage-epoch-external-evidence','finalize-epoch-input','qualify-current-epoch','verify-qualified-current-epoch','held-candidate-readback','stage-candidate-and-seal','canonical-candidate-acceptance','browser-candidate-acceptance','read-public-candidate-identity','observe-opened-candidate'] as const;
export type MaintenanceSourceAction=typeof maintenanceSourceActions[number];
export const candidateSafetyActions = ['block','rebind-held-epoch-for-reblock','verify-blocked'] as const;
const candidateSafetyRequest=(message:Record<string,unknown>)=>(message.operation==='candidate-operation'&&candidateSafetyActions.includes(message.action as typeof candidateSafetyActions[number]))||(message.operation==='callback'&&message.callback==='recordWriteStateReconciliationRequired');
const databases = ['workspacex','workspacex_agent','workspacex_memory'];
function requireProof(ok: unknown,code: string): asserts ok { if(!ok)throw new Error(code); }
const asciiJson=(value:unknown):string=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
function canonical(value: any): string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>asciiJson(k)+':'+canonical(value[k])).join(',')+'}';return asciiJson(value);}
export const runtimeDigest=(value: unknown): string=>createHash('sha256').update(canonical(value)).digest('hex');
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** A sealed plaintext session is valid only through the protected per-session
 * authority already enforced by the pinned helper, never a TLS boolean opt-out. */
export function verifySealedSessionTransport(session:any,authority:any,identity:MaintenanceIdentity,toolRevision:string):void {
 if(authority===undefined){requireProof(session.tls?.ssl===true,'SEALED_RUNTIME_SESSION_TLS');return;}
 const now=Date.now()/1000;
 requireProof(authority.schemaVersion===1&&authority.kind==='existing-production-maintenance-transport'&&equal(authority.identity,identity)&&authority.toolRevision===toolRevision&&authority.source?.sslMode==='disable'&&authority.configurationPath===`/etc/workspacex-cn/maintenance-host/${identity.sourceRevision}/${identity.attemptId}/approved-baseline-deployment.json`&&authority.configurationSha256===authority.source.configurationSha256&&Number.isFinite(authority.notBefore)&&Number.isFinite(authority.expiresAt)&&authority.expiresAt-authority.notBefore<=3600&&authority.notBefore<=now&&now<authority.expiresAt,'SEALED_RUNTIME_TRANSPORT_AUTHORITY');
 requireProof(session.tls?.ssl===false&&session.socket?.localAddress==='192.168.100.40','SEALED_RUNTIME_SESSION_TRANSPORT');
 const proof=verifyExistingMaintenanceTransport(authority,{database:session.peer.database,user:session.role,serverAddress:session.peer.serverAddr,serverPort:session.peer.serverPort,...session.socket});
 requireProof(equal(session.transport,proof),'SEALED_RUNTIME_TRANSPORT_PROOF');
}
export interface RuntimeExpected {
 identity: MaintenanceIdentity; toolRevision: string; sourcePlanPath: string; sourcePlanSha256: string; sourcePlan: Record<string,any>;
}
export interface SealedRuntimePlan {
 schemaVersion:1;kind:'sealed-maintenance-writer-runtime';identity:MaintenanceIdentity;toolRevision:string;
 sourcePlanPath:string;sourcePlanSha256:string;sourcePlanCanonicalSha256:string;runtimePlanSha256:string;runtimePlan:Record<string,any>;sessionsSha256:string;processIdentity:Record<string,any>;ready:false;productionAvailabilityProven:false;
}
/** Data-only schema. Actual filesystem ownership/hash validation lives in the read wrapper. */
export function parseProtectedRuntimePlan(value:unknown,expected:RuntimeExpected):SealedRuntimePlan {
 requireProof(/^[a-f0-9]{40}$/.test(expected.toolRevision)&&expected.sourcePlan.runtimeSessionBootstrapAuthorized===true&&expected.sourcePlan.productionActionsAuthorized===true&&expected.sourcePlanPath.startsWith('/etc/workspacex-cn/')&&!expected.sourcePlanPath.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(expected.sourcePlanSha256),'SEALED_RUNTIME_EXPECTED_BINDING');
 requireProof(value&&typeof value==='object','SEALED_RUNTIME_SCHEMA');const v=value as SealedRuntimePlan;
 requireProof(Object.keys(v).sort().join(',')===['schemaVersion','kind','identity','toolRevision','sourcePlanPath','sourcePlanSha256','sourcePlanCanonicalSha256','runtimePlanSha256','runtimePlan','sessionsSha256','processIdentity','ready','productionAvailabilityProven'].sort().join(','),'SEALED_RUNTIME_SCHEMA');
 requireProof(v.schemaVersion===1&&v.kind==='sealed-maintenance-writer-runtime'&&v.ready===false&&v.productionAvailabilityProven===false,'SEALED_RUNTIME_SCHEMA');
 requireProof(equal(v.identity,expected.identity)&&v.toolRevision===expected.toolRevision&&v.sourcePlanPath===expected.sourcePlanPath&&v.sourcePlanSha256===expected.sourcePlanSha256,'SEALED_RUNTIME_SOURCE_BINDING');
 requireProof(v.sourcePlanCanonicalSha256===runtimeDigest(expected.sourcePlan)&&v.runtimePlanSha256===runtimeDigest(v.runtimePlan),'SEALED_RUNTIME_DIGEST');
 const p=v.runtimePlan;requireProof(p&&equal(p.identity,expected.identity)&&p.toolRevision===expected.toolRevision&&p.runtimeSourcePlanSha256===v.sourcePlanCanonicalSha256,'SEALED_RUNTIME_PLAN_IDENTITY');
 // Only these fields may be replaced by observed connection identities.
 const source={...p};for(const key of ['runtimeSourcePlanSha256','controlSessions','diagnosticSessions','diagnosticClientAddress','runtimeHelperProcesses'])delete source[key];
 if(expected.sourcePlan.holdGenerationPolicy==='bind-held-at-runtime'){requireProof(/^[a-f0-9]{32}$/.test(p.holdGeneration),'SEALED_RUNTIME_HOLD_GENERATION');delete source.holdGeneration;}
 const base={...expected.sourcePlan};for(const key of ['runtimeSourcePlanSha256','controlSessions','diagnosticSessions','diagnosticClientAddress','runtimeHelperProcesses'])delete base[key];
 if(expected.sourcePlan.holdGenerationPolicy==='bind-held-at-runtime')delete base.holdGeneration;
 requireProof(equal(source,base),'SEALED_RUNTIME_UNAPPROVED_CHANGE');
 for(const mode of ['control','diagnostic'] as const){const sessions=p[mode+'Sessions'];requireProof(sessions&&Object.keys(sessions).sort().join(',')===[...databases].sort().join(','),'SEALED_RUNTIME_DATABASE_SET');
  for(const db of databases){const session=sessions[db];requireProof(session&&equal(session.peer,expected.sourcePlan.databasePeers[db])&&Number.isSafeInteger(session.pid)&&session.pid>1&&typeof session.backendStart==='string'&&session.backendStart.length>0&&typeof session.clientAddr==='string','SEALED_RUNTIME_SESSION_IDENTITY');verifySealedSessionTransport(session,expected.sourcePlan.connectionTransportAuthorizations?.[db]?.[mode],expected.identity,expected.toolRevision);requireProof(mode==='diagnostic'?session.role===expected.sourcePlan.diagnosticRole:expected.sourcePlan.databaseWriterRoles[db].includes(session.role),'SEALED_RUNTIME_SESSION_ROLE');if(mode==='diagnostic')requireProof(session.clientAddr===p.diagnosticClientAddress,'SEALED_RUNTIME_DIAGNOSTIC_ADDRESS');}
 }
 requireProof(v.sessionsSha256===runtimeDigest({control:p.controlSessions,diagnostic:p.diagnosticSessions}),'SEALED_RUNTIME_SESSION_DIGEST');
 const process=v.processIdentity;requireProof(process?.kind==='process'&&process.uid===0&&Number.isSafeInteger(process.pid)&&process.pid>1&&Number.isSafeInteger(process.startTicks)&&process.startTicks>0&&typeof process.exe==='string'&&process.exe.startsWith('/')&&/^[a-f0-9]{64}$/.test(process.exeSha256),'SEALED_RUNTIME_PROCESS_IDENTITY');
 const helpers=p.runtimeHelperProcesses;requireProof(Array.isArray(helpers)&&helpers.length===6&&new Set(helpers.map((h:any)=>h.pid)).size===6,'SEALED_RUNTIME_HELPER_SET');for(const helper of helpers)requireProof(helper.uid===0&&helper.parentPid===process.pid&&helper.exe===expected.sourcePlan.controlRuntime.nodePath&&helper.exeSha256===expected.sourcePlan.controlRuntime.nodeSha256&&Number.isSafeInteger(helper.pid)&&helper.pid>1&&Number.isSafeInteger(helper.startTicks)&&helper.startTicks>0,'SEALED_RUNTIME_HELPER_IDENTITY');
 return v;
}
export function readProtectedRuntimePlan(path:string,sha256:string,expected:RuntimeExpected):SealedRuntimePlan {
 requireProof(path===`/var/lib/workspacex-cn/runtime/${expected.identity.attemptId}/sealed-writer-runtime.json`&&/^[a-f0-9]{64}$/.test(sha256),'SEALED_RUNTIME_PATH');
 return parseProtectedRuntimePlan(protectedPrivateJson(path,sha256),expected);
}
export interface PersistentFenceDriver { request(message:Record<string,unknown>):Promise<any>; started():Promise<any>; close():Promise<void>; retain():void }
export const persistentSourceModules=Object.freeze(Object.fromEntries(['acceptance_receipt_store','candidate_canonical_acceptance','candidate_browser_acceptance','candidate_readonly_docker','candidate_stage_actions','candidate_stage_host','candidate_plan_producer','candidate_pointer_adapter','candidate_completion_contract','concretize_candidate_template','maintenance_source_operations','parent_source_invocation_receipt','cn_backup_backend','cn_backup_channel','cn_backup_host','cn_backup_package','cn_backup_sql','cn_backup_stream','cn_backup_watchdog','cn_maintenance_hold','cn_production_recovery_executor','current_epoch_qualification','current_held_epoch_evidence_producer','isolated_canonical_plan_factory','isolated_conservation_evidence_producer','isolated_conservation_inputs','isolated_conservation_plan','isolated_conservation_stage','isolated_rehearsal','opened_host_evidence','opened_service_health','retained_backend_observer','retained_backup_host','retained_epoch_acquisition','retained_epoch_capture'].map(n=>[n,n+'.py']).concat([['epoch_recovery','cn-maintenance-recovery-evidence-verifier.py'],['compiled_maintenance_activation','cn-maintenance-activation.py']])));
export interface PersistentWriterSpec extends RuntimeExpected { host:HostBinding; modules:Record<'writer_fence'|'fixed_probes'|'control_connection',TrustedExecutable>; candidate?:{reference?:{path:string;sha256:string};modules:Record<'candidate_writer'|'candidate_backend_collector'|'candidate_host_transport',TrustedExecutable>}; sourceOperationModules?:Readonly<Record<string,TrustedExecutable>>; readSeal?:(path:string,sha:string,expected:RuntimeExpected)=>SealedRuntimePlan; readCandidatePlan?:typeof protectedPrivateJson; driverFactory?:(spec:PersistentWriterSpec)=>PersistentFenceDriver }
function launch(spec:PersistentWriterSpec):PersistentFenceDriver {
 requireProof(process.platform==='linux'&&process.getuid?.()===0,'ROOT_LINUX_REQUIRED');fstatSync(9);
 const descriptors:number[]=[];
 try{
  descriptors.push(protectedExecutable(spec.host.writerFence));
  for(const name of ['writer_fence','control_connection','fixed_probes'] as const)descriptors.push(protectedExecutable(spec.modules[name]));
  if(spec.candidate){requireProof(Object.keys(spec.candidate.modules).sort().join(',')==='candidate_backend_collector,candidate_host_transport,candidate_writer'&&(!spec.candidate.reference||(spec.candidate.reference.path===`/etc/workspacex-cn/maintenance-candidate/${spec.identity.sourceRevision}/${spec.identity.attemptId}/candidate-plan.json`&&/^[a-f0-9]{64}$/.test(spec.candidate.reference.sha256))),'PERSISTENT_CANDIDATE_SOURCE_CLOSURE');for(const name of ['candidate_writer','candidate_backend_collector','candidate_host_transport'] as const){requireProof(spec.candidate.modules[name].path===`/usr/local/lib/workspacex-cn/${name}.py`,'PERSISTENT_CANDIDATE_MODULE_PATH');descriptors.push(protectedExecutable(spec.candidate.modules[name]));}}
  const lazy:Record<string,string>={};
  if(spec.sourceOperationModules){
   requireProof(spec.candidate&&Object.keys(spec.sourceOperationModules).sort().join(',')===Object.keys(persistentSourceModules).sort().join(','),'PERSISTENT_OPERATION_MODULE_CLOSURE');
   for(const [name,file] of Object.entries(persistentSourceModules).sort()){
    const command=spec.sourceOperationModules[name]!;requireProof(command.path===`/usr/local/lib/workspacex-cn/${file}`,'PERSISTENT_OPERATION_MODULE_PATH');
    lazy[name]=`/proc/self/fd/${10+descriptors.length}`;descriptors.push(protectedExecutable(command));
   }
  }
  const bootstrap="import sys,importlib.util,importlib.machinery; "+pinnedPythonModuleFinder(lazy)+'\n'+['writer_fence','control_connection','fixed_probes','host_transport'].map((name,i)=>{const fd=name==='host_transport'?10:11+i;return `s=importlib.util.spec_from_loader('${name}',importlib.machinery.SourceFileLoader('${name}','/proc/self/fd/${fd}'));m=importlib.util.module_from_spec(s);sys.modules['${name}']=m;s.loader.exec_module(m);`;}).join(' ') +(spec.candidate?['candidate_writer','candidate_backend_collector','candidate_host_transport'].map((name,i)=>`s=importlib.util.spec_from_loader('${name}',importlib.machinery.SourceFileLoader('${name}','/proc/self/fd/${14+i}'));m=importlib.util.module_from_spec(s);sys.modules['${name}']=m;s.loader.exec_module(m);`).join(' '):'')+" sys.modules['host_transport'].serve_reviewed_fence(sys.argv[1],sys.argv[2])";
  const child=spawn('/usr/bin/python3',['-I','-c',bootstrap,spec.sourcePlanPath,spec.sourcePlanSha256],{shell:false,detached:false,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'},stdio:['pipe','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9,...descriptors]});
  let buffer=Buffer.alloc(0),sequence=0,retained=false,dead=false;const expired=new Set<number>();const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const rejectAll=()=>{dead=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('PERSISTENT_FENCE_CONNECTION_LOST'));}pending.clear();};
  const receive=(value:any)=>{const p=pending.get(value.sequence);if(!p){if(expired.delete(value.sequence)){retained=true;return;}rejectAll();return;}pending.delete(value.sequence);clearTimeout(p.timer);value.ok===true?p.resolve(value):p.reject(new Error('PERSISTENT_FENCE_REJECTED'));};
  const wait=(n:number,timeoutMs=300000)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);expired.add(n);retained=true;if(expired.size>64)rejectAll();reject(new Error('PERSISTENT_FENCE_DEADLINE_UNKNOWN'));},timeoutMs);pending.set(n,{resolve,reject,timer});});
  const start=wait(0);
  child.stdout!.on('data',(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1048576){retained=true;rejectAll();return;}let index:number;while((index=buffer.indexOf(10))!==-1){const line=buffer.subarray(0,index);buffer=buffer.subarray(index+1);try{receive(JSON.parse(line.toString('utf8')));}catch{retained=true;rejectAll();}}});
  child.stderr!.resume();child.on('error',rejectAll);child.on('exit',rejectAll);
  return {started:async()=>{const reply=await start;requireProof(reply.processIdentity?.pid===child.pid,'PERSISTENT_SERVER_PID_BINDING');return reply;},request:message=>{requireProof(!dead&&(!retained||candidateSafetyRequest(message)),'PERSISTENT_FENCE_RETAINED_OR_LOST');const n=++sequence;const recoveryTimeout=spec.sourcePlan.recoveryAuthorization?.operationTimeoutMs;const response=wait(n,message.operation==='migrate-exact-plan'?spec.sourcePlan.migrationAuthorization?.operationTimeoutMs:message.operation==='recover-retained-baseline'?recoveryTimeout*3+60000:undefined);child.stdin!.write(JSON.stringify({...message,sequence:n})+'\n');return response;},retain:()=>{retained=true;},close:async()=>{requireProof(!retained,'PERSISTENT_FENCE_RETAINED');child.stdin!.end();await new Promise<void>((resolve,reject)=>{if(child.exitCode!==null)return child.exitCode===0?resolve():reject(new Error('PERSISTENT_FENCE_EXIT_FAILED'));const timer=setTimeout(()=>reject(new Error('PERSISTENT_FENCE_CLOSE_DEADLINE')),10000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('PERSISTENT_FENCE_EXIT_FAILED'));});});}};
 }finally{for(const fd of descriptors)closeSync(fd);}
}
/** One server owns all seven writer callbacks and all six DB connections. */
export function createPersistentWriterLifecycle(spec:PersistentWriterSpec) {
 let driver:PersistentFenceDriver|undefined,binding:HostBinding|undefined,sealedRecord:SealedRuntimePlan|undefined,unknown=false,accepted=false,migrated=false,candidateReference=spec.candidate?.reference?Object.freeze({...spec.candidate.reference}):undefined;
 return {
  async start():Promise<HostBinding>{requireProof(!driver,'PERSISTENT_WRITER_ALREADY_STARTED');requireProof(spec.sourcePlanPath===spec.host.writerPlanPath&&spec.sourcePlanSha256===spec.host.writerPlanSha256&&equal(spec.identity,spec.host.identity),'PERSISTENT_WRITER_SOURCE_BINDING');driver=(spec.driverFactory??launch)(spec);try{const reply=await driver.started();requireProof(reply.kind==='persistent-writer-runtime-started'&&equal(reply.identity,spec.identity)&&reply.toolRevision===spec.toolRevision,'PERSISTENT_WRITER_START_PROTOCOL');const sealed=(spec.readSeal??readProtectedRuntimePlan)(reply.sealedPlanPath,reply.sealedPlanSha256,spec);requireProof(sealed.runtimePlanSha256===reply.runtimePlanSha256&&equal(sealed.processIdentity,reply.processIdentity),'PERSISTENT_WRITER_SEAL_BINDING');sealedRecord=sealed;binding={...spec.host,writerPlanPath:reply.sealedPlanPath,writerPlanSha256:reply.sealedPlanSha256,writerPlanCanonicalSha256:sealed.runtimePlanSha256};return binding;}catch(error){unknown=true;driver.retain();throw error;}},
  async invoke(callback:typeof writerCallbacks[number],identity:MaintenanceIdentity):Promise<CommandResult>{requireProof(driver&&binding&&(!unknown||callback==='recordWriteStateReconciliationRequired')&&writerCallbacks.includes(callback)&&equal(identity,spec.identity),'PERSISTENT_WRITER_CALLBACK_BINDING');try{const response=await driver.request({operation:'callback',callback,identity});if(callback==='verifyWritesResumed'){requireProof(response.value?.callback===callback&&response.value.state==='writes-resumed'&&response.value.ready===false&&response.value.productionAvailabilityProven===false&&equal(response.value.identity,spec.identity),'PERSISTENT_WRITER_ACCEPTED_READBACK');accepted=true;}return {stdout:JSON.stringify(response.value)};}catch(error){unknown=true;driver.retain();throw error;}},
  async baselineCancellation(identity:MaintenanceIdentity,action:'verify-no-migration'|'resume-baseline'|'verify-baseline'):Promise<void>{
   requireProof(driver&&binding&&!unknown&&!migrated&&equal(identity,spec.identity)&&sealedRecord&&spec.candidate,'PERSISTENT_BASELINE_CANCEL_BINDING');
   try{const reply=await driver.request({operation:'baseline-cancellation-operation',identity,action}),v=reply.value;
    requireProof(v?.schemaVersion===1&&v.kind==='baseline-cancellation-operation'&&equal(v.identity,identity)&&v.operation===action&&v.planSha256===sealedRecord.runtimePlanSha256&&v.holdState==='held'&&v.writesHeld===(action==='verify-no-migration')&&v.ready===false&&v.productionAvailabilityProven===false&&(action==='resume-baseline'||/^[a-f0-9]{64}$/.test(v.observationSha256)),'PERSISTENT_BASELINE_CANCEL_READBACK');
    if(action==='verify-baseline')accepted=true;
   }catch(error){unknown=true;driver.retain();throw error;}
  },
  async bindCandidateReference(identity:MaintenanceIdentity,reference:{path:string;sha256:string}):Promise<void>{
   requireProof(driver&&binding&&!unknown&&migrated&&spec.candidate&&!candidateReference&&equal(identity,spec.identity)&&reference.path===`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`&&/^[a-f0-9]{64}$/.test(reference.sha256),'PERSISTENT_CANDIDATE_LATE_BINDING');
   const value=(spec.readCandidatePlan??protectedPrivateJson)(reference.path,reference.sha256) as any;
   requireProof(value&&Object.keys(value).sort().join(',')==='artifact,plan,schemaVersion,toolRevision'&&value.artifact&&Object.keys(value.artifact).sort().join(',')==='path,sha256'&&typeof value.artifact.path==='string'&&value.artifact.path.startsWith('/etc/workspacex-cn/')&&!value.artifact.path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(value.artifact.sha256)&&value.plan?.artifactSha256===value.artifact.sha256&&value.schemaVersion===1&&value.toolRevision===spec.toolRevision&&equal(value.plan?.identity,identity)&&value.plan?.holdGeneration===sealedRecord?.runtimePlan.holdGeneration&&/^[a-f0-9]{64}$/.test(value.plan?.epoch)&&/^[a-f0-9]{64}$/.test(value.plan?.migrationCompletionSha256),'PERSISTENT_CANDIDATE_LATE_PLAN');
   candidateReference=Object.freeze({...reference});
  },
  async sourceOperation(identity:MaintenanceIdentity,action:MaintenanceSourceAction,input:{path:string;sha256:string}):Promise<unknown>{
   requireProof(driver&&binding&&!unknown&&spec.sourceOperationModules&&equal(identity,spec.identity)&&maintenanceSourceActions.includes(action)&&input.path===`/etc/workspacex-cn/maintenance-source-inputs/${identity.sourceRevision}/${identity.attemptId}/${action}.json`&&/^[a-f0-9]{64}$/.test(input.sha256),'PERSISTENT_SOURCE_OPERATION_BINDING');
   try{const reply=await driver.request({operation:'maintenance-source-operation',identity,action,input}),v=reply.value;
    requireProof(v?.schemaVersion===1&&v.kind==='maintenance-source-operation'&&equal(v.identity,identity)&&v.toolRevision===spec.toolRevision&&v.action===action&&equal(v.input,input)&&v.ready===false&&v.productionAvailabilityProven===false&&v.value&&typeof v.value==='object','PERSISTENT_SOURCE_OPERATION_READBACK');return v.value;
   }catch(error){unknown=true;driver.retain();throw error;}
  },
  async candidateOperation(identity:MaintenanceIdentity,action:'prepare-resume-intent'|'verify-staging'|'resume'|'verify-resumed'|'block'|'observe-opened'|'rebind-held-epoch-for-reblock'|'verify-blocked'):Promise<void>{
   const reference=candidateReference;
   requireProof(driver&&binding&&(!unknown||candidateSafetyActions.includes(action as typeof candidateSafetyActions[number]))&&spec.candidate&&reference&&equal(identity,spec.identity)&&reference.path===`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`&&/^[a-f0-9]{64}$/.test(reference.sha256),'PERSISTENT_CANDIDATE_BINDING');
   try{const reply=await driver.request({operation:'candidate-operation',identity,candidatePlan:reference,action}),v=reply.value;
    requireProof(v?.schemaVersion===1&&v.kind==='candidate-host-operation'&&equal(v.identity,identity)&&v.operation===action&&v.planSha256===reference.sha256&&/^[a-f0-9]{64}$/.test(v.candidatePlanSha256)&&v.holdState===(action==='observe-opened'?'cleared':'held')&&v.ready===false&&v.productionAvailabilityProven===false&&(action==='rebind-held-epoch-for-reblock'||action==='prepare-resume-intent'||/^[a-f0-9]{64}$/.test(v.observationSha256)),'PERSISTENT_CANDIDATE_READBACK');
    if(action==='observe-opened'&&!unknown)accepted=true;
    if(candidateSafetyActions.includes(action as typeof candidateSafetyActions[number]))accepted=false;
   }catch(error){unknown=true;driver.retain();throw error;}
  },
  async migrateExactPlan(identity:MaintenanceIdentity):Promise<{applied:string[];skipped:string[]}>{requireProof(driver&&binding&&!unknown&&equal(identity,spec.identity)&&spec.sourcePlan.migrationAuthorization,'PERSISTENT_MIGRATION_AUTHORIZATION');try{const reply=await driver.request({operation:'migrate-exact-plan',identity});requireProof(Array.isArray(reply.value?.applied)&&Array.isArray(reply.value?.skipped),'PERSISTENT_MIGRATION_RESULT');migrated=true;return reply.value;}catch(error){unknown=true;driver.retain();throw error;}},
  async recoverRetainedBaseline(identity:MaintenanceIdentity,recoveryPlan:{path:string;sha256:string}):Promise<{schemaVersion:1;kind:'production-recovery-completed';identity:MaintenanceIdentity;receiptSha256:string;writesHeld:true;ready:false}>{
   const auth=spec.sourcePlan.recoveryAuthorization;
   requireProof(driver&&binding&&!unknown&&equal(identity,spec.identity)&&auth&&auth.identity&&equal(auth.identity,identity)&&Number.isSafeInteger(auth.operationTimeoutMs)&&auth.operationTimeoutMs>=10000&&auth.operationTimeoutMs<=1800000&&equal(recoveryPlan,{path:auth.planPath,sha256:auth.planSha256}),'PERSISTENT_RECOVERY_AUTHORIZATION');
   try{const reply=await driver.request({operation:'recover-retained-baseline',identity,recoveryPlan}),v=reply.value;requireProof(v?.schemaVersion===1&&v.kind==='production-recovery-completed'&&equal(v.identity,identity)&&/^[a-f0-9]{64}$/.test(v.receiptSha256)&&v.writesHeld===true&&v.ready===false,'PERSISTENT_RECOVERY_READBACK');return v;}catch(error){unknown=true;driver.retain();throw error;}
  },
  async recordMigrationCompletion(identity:MaintenanceIdentity,stage:'intent'|'durable',receipt:{path:string;sha256:string}):Promise<void>{requireProof(driver&&binding&&!unknown&&migrated&&equal(identity,spec.identity)&&(stage==='intent'||stage==='durable')&&receipt.path===`/etc/workspacex-cn/migration-completion-inputs/${identity.sourceRevision}/${identity.attemptId}.completed.json`&&/^[a-f0-9]{64}$/.test(receipt.sha256),'PERSISTENT_MIGRATION_COMPLETION_BINDING');try{const reply=await driver.request({operation:'record-migration-completion',identity,stage,receipt});requireProof(reply.value?.stage===stage&&reply.value.ready===false&&equal(reply.value.identity,identity)&&equal(reply.value.receipt,receipt),'PERSISTENT_MIGRATION_COMPLETION_READBACK');}catch(error){unknown=true;driver.retain();throw error;}},
  async readRunDrain(identity:MaintenanceIdentity):Promise<{queued:number;running:number;writebackPending:number}>{
   requireProof(driver&&binding&&!unknown&&equal(identity,spec.identity),'PERSISTENT_DRAIN_IDENTITY');
   try {const reply=await driver.request({operation:'read-run-drain',identity});const v=reply.value;
    requireProof(v&&v.writesHeld===true&&typeof v.holdGeneration==='string'&&/^[a-f0-9]{32}$/.test(v.holdGeneration)&&equal(v.identity,identity)&&sealedRecord&&v.holdGeneration===sealedRecord.runtimePlan.holdGeneration&&equal(v.connection,sealedRecord.runtimePlan.diagnosticSessions.workspacex)&&typeof v.observedAt==='number'&&Date.now()/1000-v.observedAt>=0&&Date.now()/1000-v.observedAt<=30&&['queued','running','writebackPending'].every(k=>Number.isSafeInteger(v[k])&&v[k]>=0),'PERSISTENT_DRAIN_READBACK');
    return {queued:v.queued,running:v.running,writebackPending:v.writebackPending};
   }catch(error){unknown=true;driver.retain();throw error;}
  },
  async readDiagnosticLedger(identity:MaintenanceIdentity):Promise<{ledger:Array<{name:string;checksum:string;appliedAt:string}>;rowCount:number;connection:Record<string,any>;observedAt:number}>{requireProof(driver&&binding&&!unknown&&equal(identity,spec.identity),'PERSISTENT_DIAGNOSTIC_IDENTITY');try{const reply=await driver.request({operation:'read-diagnostic-ledger',identity});requireProof(Array.isArray(reply.value?.ledger)&&reply.value.rowCount===reply.value.ledger.length&&typeof reply.value.observedAt==='number'&&sealedRecord&&equal(reply.value.connection,sealedRecord.runtimePlan.diagnosticSessions.workspacex),'PERSISTENT_DIAGNOSTIC_LEDGER');return reply.value;}catch(error){unknown=true;driver.retain();throw error;}},
  async closeAfterAccepted():Promise<void>{requireProof(driver&&accepted&&!unknown,'PERSISTENT_WRITER_CLOSE_NOT_ACCEPTED');try{const reply=await driver.request({operation:'close-accepted',identity:spec.identity});requireProof(reply.closed===true,'PERSISTENT_WRITER_CLOSE_READBACK');await driver.close();}catch(error){unknown=true;driver.retain();throw error;}},
  retainUnknown():void{unknown=true;driver?.retain();},
 };
}
