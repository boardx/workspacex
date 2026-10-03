import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, fstatSync } from 'node:fs';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import { protectedPrivateJson, protectedExecutable, type TrustedExecutable, type CommandResult } from './fixed_transport';
import { writerCallbacks, type HostBinding } from './controller';
const databases = ['workspacex','workspacex_agent','workspacex_memory'];
function requireProof(ok: unknown,code: string): asserts ok { if(!ok)throw new Error(code); }
const asciiJson=(value:unknown):string=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
function canonical(value: any): string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>asciiJson(k)+':'+canonical(value[k])).join(',')+'}';return asciiJson(value);}
export const runtimeDigest=(value: unknown): string=>createHash('sha256').update(canonical(value)).digest('hex');
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
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
  for(const db of databases){const session=sessions[db];requireProof(session&&equal(session.peer,expected.sourcePlan.databasePeers[db])&&session.tls?.ssl===true&&Number.isSafeInteger(session.pid)&&session.pid>1&&typeof session.backendStart==='string'&&session.backendStart.length>0&&typeof session.clientAddr==='string','SEALED_RUNTIME_SESSION_IDENTITY');requireProof(mode==='diagnostic'?session.role===expected.sourcePlan.diagnosticRole:expected.sourcePlan.databaseWriterRoles[db].includes(session.role),'SEALED_RUNTIME_SESSION_ROLE');if(mode==='diagnostic')requireProof(session.clientAddr===p.diagnosticClientAddress,'SEALED_RUNTIME_DIAGNOSTIC_ADDRESS');}
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
export interface PersistentWriterSpec extends RuntimeExpected { host:HostBinding; modules:Record<'writer_fence'|'fixed_probes'|'control_connection',TrustedExecutable>; readSeal?:(path:string,sha:string,expected:RuntimeExpected)=>SealedRuntimePlan; driverFactory?:(spec:PersistentWriterSpec)=>PersistentFenceDriver }
function launch(spec:PersistentWriterSpec):PersistentFenceDriver {
 requireProof(process.platform==='linux'&&process.getuid?.()===0,'ROOT_LINUX_REQUIRED');fstatSync(9);
 const descriptors:number[]=[];
 try{
  descriptors.push(protectedExecutable(spec.host.writerFence));
  for(const name of ['writer_fence','control_connection','fixed_probes'] as const)descriptors.push(protectedExecutable(spec.modules[name]));
  const bootstrap="import sys,importlib.util,importlib.machinery; "+['writer_fence','control_connection','fixed_probes','host_transport'].map((name,i)=>{const fd=name==='host_transport'?10:11+i;return `s=importlib.util.spec_from_loader('${name}',importlib.machinery.SourceFileLoader('${name}','/proc/self/fd/${fd}'));m=importlib.util.module_from_spec(s);sys.modules['${name}']=m;s.loader.exec_module(m);`;}).join(' ') +" sys.modules['host_transport'].serve_reviewed_fence(sys.argv[1],sys.argv[2])";
  const child=spawn('/usr/bin/python3',['-I','-c',bootstrap,spec.sourcePlanPath,spec.sourcePlanSha256],{shell:false,detached:false,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'},stdio:['pipe','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9,...descriptors]});
  let buffer=Buffer.alloc(0),sequence=0,retained=false,dead=false;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const rejectAll=()=>{dead=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('PERSISTENT_FENCE_CONNECTION_LOST'));}pending.clear();};
  const receive=(value:any)=>{const p=pending.get(value.sequence);if(!p){rejectAll();return;}pending.delete(value.sequence);clearTimeout(p.timer);value.ok===true?p.resolve(value):p.reject(new Error('PERSISTENT_FENCE_REJECTED'));};
  const wait=(n:number,timeoutMs=300000)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);retained=true;reject(new Error('PERSISTENT_FENCE_DEADLINE_UNKNOWN'));},timeoutMs);pending.set(n,{resolve,reject,timer});});
  const start=wait(0);
  child.stdout!.on('data',(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1048576){retained=true;rejectAll();return;}let index:number;while((index=buffer.indexOf(10))!==-1){const line=buffer.subarray(0,index);buffer=buffer.subarray(index+1);try{receive(JSON.parse(line.toString('utf8')));}catch{retained=true;rejectAll();}}});
  child.stderr!.resume();child.on('error',rejectAll);child.on('exit',rejectAll);
  return {started:async()=>{const reply=await start;requireProof(reply.processIdentity?.pid===child.pid,'PERSISTENT_SERVER_PID_BINDING');return reply;},request:message=>{requireProof(!dead&&!retained,'PERSISTENT_FENCE_RETAINED_OR_LOST');const n=++sequence;const response=wait(n,message.operation==='migrate-exact-plan'?spec.sourcePlan.migrationAuthorization?.operationTimeoutMs:undefined);child.stdin!.write(JSON.stringify({...message,sequence:n})+'\n');return response;},retain:()=>{retained=true;},close:async()=>{requireProof(!retained,'PERSISTENT_FENCE_RETAINED');child.stdin!.end();await new Promise<void>((resolve,reject)=>{if(child.exitCode!==null)return child.exitCode===0?resolve():reject(new Error('PERSISTENT_FENCE_EXIT_FAILED'));const timer=setTimeout(()=>reject(new Error('PERSISTENT_FENCE_CLOSE_DEADLINE')),10000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('PERSISTENT_FENCE_EXIT_FAILED'));});});}};
 }finally{for(const fd of descriptors)closeSync(fd);}
}
/** One server owns all seven writer callbacks and all six DB connections. */
export function createPersistentWriterLifecycle(spec:PersistentWriterSpec) {
 let driver:PersistentFenceDriver|undefined,binding:HostBinding|undefined,sealedRecord:SealedRuntimePlan|undefined,unknown=false,accepted=false,migrated=false;
 return {
  async start():Promise<HostBinding>{requireProof(!driver,'PERSISTENT_WRITER_ALREADY_STARTED');requireProof(spec.sourcePlanPath===spec.host.writerPlanPath&&spec.sourcePlanSha256===spec.host.writerPlanSha256&&equal(spec.identity,spec.host.identity),'PERSISTENT_WRITER_SOURCE_BINDING');driver=(spec.driverFactory??launch)(spec);try{const reply=await driver.started();requireProof(reply.kind==='persistent-writer-runtime-started'&&equal(reply.identity,spec.identity)&&reply.toolRevision===spec.toolRevision,'PERSISTENT_WRITER_START_PROTOCOL');const sealed=(spec.readSeal??readProtectedRuntimePlan)(reply.sealedPlanPath,reply.sealedPlanSha256,spec);requireProof(sealed.runtimePlanSha256===reply.runtimePlanSha256&&equal(sealed.processIdentity,reply.processIdentity),'PERSISTENT_WRITER_SEAL_BINDING');sealedRecord=sealed;binding={...spec.host,writerPlanPath:reply.sealedPlanPath,writerPlanSha256:reply.sealedPlanSha256,writerPlanCanonicalSha256:sealed.runtimePlanSha256};return binding;}catch(error){unknown=true;driver.retain();throw error;}},
  async invoke(callback:typeof writerCallbacks[number],identity:MaintenanceIdentity):Promise<CommandResult>{requireProof(driver&&binding&&!unknown&&writerCallbacks.includes(callback)&&equal(identity,spec.identity),'PERSISTENT_WRITER_CALLBACK_BINDING');try{const response=await driver.request({operation:'callback',callback,identity});if(callback==='verifyWritesResumed'){requireProof(response.value?.callback===callback&&response.value.state==='writes-resumed'&&response.value.ready===false&&response.value.productionAvailabilityProven===false&&equal(response.value.identity,spec.identity),'PERSISTENT_WRITER_ACCEPTED_READBACK');accepted=true;}return {stdout:JSON.stringify(response.value)};}catch(error){unknown=true;driver.retain();throw error;}},
  async migrateExactPlan(identity:MaintenanceIdentity):Promise<{applied:string[];skipped:string[]}>{requireProof(driver&&binding&&!unknown&&equal(identity,spec.identity)&&spec.sourcePlan.migrationAuthorization,'PERSISTENT_MIGRATION_AUTHORIZATION');try{const reply=await driver.request({operation:'migrate-exact-plan',identity});requireProof(Array.isArray(reply.value?.applied)&&Array.isArray(reply.value?.skipped),'PERSISTENT_MIGRATION_RESULT');migrated=true;return reply.value;}catch(error){unknown=true;driver.retain();throw error;}},
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
