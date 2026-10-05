import { createHash } from 'node:crypto';
import { closeSync,openSync,constants,lstatSync,fstatSync,writeFileSync,fsyncSync,linkSync,unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyMigrationCompletion } from '../cn-migration-completion';
import {readNativeCompletion} from './native_completion';
import { validateMigrationSnapshot } from '../cn-migration-snapshot';
import { z } from 'zod';
import { verifyMigrationPeer, approveExistingNoTls } from './pinned-app-9b/migration-pg';
import { exactMigrationAction, type ExactMigrationInputs, type ExactMigrationTransport } from './reused_actions';
import { readProtectedCompletionBytes } from '../cn-migration-completion-cli';
import { migrationSourceSchema,sourceEvidenceSchema,verifyExternalSourceIdentity, identityHash } from '../cn-migration-source-identity';
import { protectedExecutable, inheritedFd9Lock, runFixedPython, type CommandRunner, type TrustedExecutable } from './fixed_transport';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
const hex=z.string().regex(/^[a-f0-9]{64}$/);
const configSchema=z.object({host:z.string().min(1).max(253),port:z.number().int().min(1).max(65535),database:z.literal('workspacex'),user:z.string().min(1),password:z.string().min(1),ssl:z.union([z.literal(false),z.object({rejectUnauthorized:z.literal(true),ca:z.string().min(1)}).strict()]),connectionTimeoutMillis:z.number().int().min(1).max(300000),statement_timeout:z.number().int().min(1).max(300000)}).strict();
export interface MigrationHostBinding {
 identity: MaintenanceIdentity;
 toolRevision: string;
 approvedRdsTlsException?: unknown;
 ddlSource: unknown;
 ddlSourceEvidence: unknown;
 configPath: string;
 configSha256: string;
 completionPath: string;
 collector: TrustedExecutable;
 writerPlanPath: string;
 writerPlanSha256: string;
 writerPlanCanonicalSha256: string;
 writerFence: TrustedExecutable;
 lockTimeoutMs: number;
}
export interface PersistentMigrationLifecycle {
 migrateExactPlan(identity:MaintenanceIdentity):Promise<{applied:readonly string[];skipped:readonly string[]}>;
 recordMigrationCompletion(identity:MaintenanceIdentity,stage:'intent'|'durable',receipt:{path:string;sha256:string}):Promise<void>;
 readDiagnosticLedger(identity:MaintenanceIdentity):Promise<{ledger:Array<{name:string;checksum:string;appliedAt?:string}>;rowCount:number;connection:any}>;
}
interface Runtime { read(path:string):Buffer; runBash:CommandRunner; runWriter:CommandRunner; verifyExecutable(value:TrustedExecutable):void; now():number; verifyCompletion:typeof verifyMigrationCompletion; persist(path:string,bytes:Buffer):Promise<void> }
const defaults: Runtime={read:readProtectedCompletionBytes,runBash:runFixedPython,runWriter:undefined as never,verifyExecutable:command=>{const fd=protectedExecutable(command);closeSync(fd);},now:Date.now,verifyCompletion:verifyMigrationCompletion,persist:async(path,bytes)=>{await inheritedFd9Lock();publishMigrationReceipt(path,bytes);}};
/** Production callers supply runWriter = runFixedPython, not plan-selected JS.
 * fixture overrides are local test API; the installed entry never deserializes them. */
/** Consume only immutable, root-protected FULL prebuild evidence before DDL.
 * Artifact-build receipts are stored separately and never grant migration. */
export function verifyBaselineMigrationAdmission(raw:Buffer,validatedRaw:Buffer,id:MaintenanceIdentity,now:number):void {
 const evidence=JSON.parse(raw.toString('utf8')),validated=JSON.parse(validatedRaw.toString('utf8'));
 const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 const hash=createHash('sha256').update(canonical(evidence)).digest('hex');
 const issued=Date.parse(evidence.issuedAt),expires=Date.parse(evidence.expiresAt);
 const b=evidence.checks?.['bootstrap.compatibility'];const proof=b?.metadata;
 if(evidence.schemaVersion!==2||evidence.phase!=='prebuild'||evidence.buildStarted!==false||evidence.sourceSha!==id.sourceRevision||evidence.baselineSha!==id.baselineRevision||evidence.attemptId!==id.attemptId||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires-issued<=0||expires-issued>3600000||validated.schemaVersion!==2||validated.phase!=='prebuild'||validated.ready!==true||!Array.isArray(validated.blockers)||validated.blockers.length||validated.receiptSha256!==hash||['sourceSha','baselineSha','attemptId','release','issuedAt','expiresAt'].some(k=>validated[k]!==evidence[k])||b?.status!=='passed'||!hex.safeParse(b?.evidenceSha256).success||proof?.evidenceMode!=='source-static'||proof?.baselineSha!==id.baselineRevision||proof?.migrationPlanSha256!==id.migrationPlanSha256||!hex.safeParse(proof?.baselineSchemaSha256).success||proof?.baselineLedgerContract!==true||proof?.baselineSchemaContract!==true||proof?.baselinePermissionContract!==true||proof?.candidateSchemaContract!==false||proof?.buildAdmissionOnly!==true||proof?.productionWriteStatements!==0)throw Error('MIGRATION_BASELINE_ADMISSION_INVALID');
}
export function createMigrationTransport(inputs:ExactMigrationInputs,binding:MigrationHostBinding,runWriter:CommandRunner,lifecycle:PersistentMigrationLifecycle,fixture?:Partial<Runtime>):ExactMigrationTransport {
 if(!lifecycle||typeof lifecycle.migrateExactPlan!=='function'||typeof lifecycle.readDiagnosticLedger!=='function'||typeof lifecycle.recordMigrationCompletion!=='function')throw new Error('PERSISTENT_MIGRATION_LIFECYCLE_REQUIRED');
 const runtime={...defaults,runWriter,...fixture};
 const id=binding.identity;const root=`/etc/workspacex-cn/maintenance-migration/${id.sourceRevision}/${id.attemptId}`;
 if(id.sourceRevision!=='9b25bfa65662b96c0826fe67506b562ea46aa6d0'||id.baselineRevision!=='ba6343199f3c834d6a198f83d0c771614292c82b'||!/^[A-Za-z0-9-]{1,128}$/.test(id.attemptId)||!hex.safeParse(id.migrationPlanSha256).success||binding.configPath!==root+'/config.json'||binding.completionPath!==`/etc/workspacex-cn/migration-completion-inputs/${id.sourceRevision}/${id.attemptId}.json`||!/^[a-f0-9]{40}$/.test(binding.toolRevision)||!hex.safeParse(binding.configSha256).success||!hex.safeParse(binding.writerPlanCanonicalSha256).success||binding.collector.path!=='/usr/local/lib/workspacex-cn/collect-cn-migration-snapshot.py'||binding.writerFence.path!=='/usr/local/lib/workspacex-cn/host_transport.py'||!Number.isSafeInteger(binding.lockTimeoutMs)||binding.lockTimeoutMs<1||binding.lockTimeoutMs>300000)throw new Error('MIGRATION_HOST_BINDING_INVALID');
 const source=migrationSourceSchema.parse(inputs.expectedCompletion.productionSource);
 const ddlSource=migrationSourceSchema.parse(binding.ddlSource);const ddlEvidence=sourceEvidenceSchema.parse(binding.ddlSourceEvidence);
 if(!verifyExternalSourceIdentity(ddlSource,ddlEvidence)||ddlSource.user===source.user||['accountId','regionId','dbInstanceId','database','endpointSha256','serverAddressSha256','port','identityLane','clientPeerAddressSha256','clientPeerPort','sslMode','clientEncrypted','clientTlsAuthorized'].some(key=>(ddlSource as any)[key]!==(source as any)[key]))throw new Error('MIGRATION_DDL_DIAGNOSTIC_TARGET_MISMATCH');
 let startedAt:number|undefined;
 let completed=false;
 const config=()=>{
  const raw=runtime.read(binding.configPath);if(createHash('sha256').update(raw).digest('hex')!==binding.configSha256)throw new Error('MIGRATION_CONFIG_HASH_CHANGED');
  const cfg=configSchema.parse(JSON.parse(raw.toString('utf8')));
  if(ddlSource.database!==cfg.database||ddlSource.user!==cfg.user||ddlSource.endpointSha256!==identityHash(`${cfg.host}:${cfg.port}`))throw new Error('MIGRATION_CONNECTION_IDENTITY_MISMATCH');
  const intended=JSON.parse(runtime.read(binding.completionPath).toString('utf8'));const evidence=sourceEvidenceSchema.parse(intended.sourceEvidence);
  if(!verifyExternalSourceIdentity(source,evidence))throw new Error('MIGRATION_EXTERNAL_SOURCE_UNVERIFIED');
  if(ddlSource.sslMode==='verify-full'){if(cfg.ssl===false||!ddlSource.clientEncrypted||!ddlSource.clientTlsAuthorized)throw new Error('MIGRATION_CONNECTION_TLS_MISMATCH');}
  else{if(cfg.ssl!==false)throw new Error('MIGRATION_CONNECTION_TLS_MISMATCH');approveExistingNoTls(ddlSource,ddlEvidence,binding.approvedRdsTlsException);}
  return {cfg,evidence};
 };
 const diagnostic=async()=>{
  const report=await lifecycle.readDiagnosticLedger(id);const connection=report.connection;const socket=connection?.socket;
  if(!connection||!socket||!Array.isArray(report.ledger)||report.rowCount!==report.ledger.length||new Set(report.ledger.map(row=>row.name)).size!==report.ledger.length)throw new Error('MIGRATION_DIAGNOSTIC_PROTOCOL');
  const intended=JSON.parse(runtime.read(binding.completionPath).toString('utf8'));
  verifyMigrationPeer(source,{database:connection.peer.database,user:connection.role,serverAddress:connection.peer.serverAddr,serverPort:connection.peer.serverPort,remoteAddress:socket.remoteAddress,remotePort:socket.remotePort,encrypted:socket.encrypted,authorized:socket.authorized,localAddress:socket.localAddress},{sourceEvidence:intended.sourceEvidence,approvedRdsTlsException:binding.approvedRdsTlsException});
  return report.ledger.map(({name,checksum})=>({name,checksum})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 };
 const barrier=async()=>{
  const result=await runtime.runWriter(binding.writerFence,['--apply-reviewed-fence',binding.writerPlanPath,binding.writerPlanSha256,'verifyWritesBlocked']);
  const fact=JSON.parse(result.stdout);const now=runtime.now()/1000;
  if(fact.schemaVersion!==1||fact.kind!=='maintenance-writers-held'||fact.ready!==false||!fact.identity||Object.entries(id).some(([k,v])=>fact.identity[k]!==v)||Object.keys(fact.identity).length!==4||!hex.safeParse(fact.planSha256).success||fact.planSha256!==binding.writerPlanCanonicalSha256||typeof fact.observedAt!=='number'||fact.observedAt>now||now-fact.observedAt>30||!hex.safeParse(fact.databaseSessionsSha256).success||!Array.isArray(fact.families)||fact.families.join(',')!=='http,socket,queue,background,agent,checkpoint,memory,privileged')throw new Error('MIGRATION_LIVE_WRITER_BARRIER_INVALID');
 };
 return {
  verifyLiveWriterBarrier:barrier,
  migrate:async()=>{
   if(startedAt!==undefined)throw new Error('MIGRATION_REENTRY_FORBIDDEN');
   // Missing collector/credentials reject before any DDL. No provision/force.
   runtime.verifyExecutable(binding.collector);runtime.verifyExecutable(binding.writerFence);
   const {cfg,evidence}=config();
   const preflight=JSON.parse((await runtime.runBash(binding.collector,['--preflight-completion',id.sourceRevision,id.attemptId,id.migrationPlanSha256])).stdout);
   if(preflight.schemaVersion!==1||preflight.kind!=='migration-collector-preflight'||preflight.ready!==false||preflight.toolRevision!==binding.toolRevision||!preflight.identity||Object.keys(preflight.identity).length!==4||Object.entries(id).some(([k,v])=>preflight.identity[k]!==v)||!hex.safeParse(preflight.querySha256).success||preflight.querySha256!==identityHash('/usr/bin/node /usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs --readonly-ledger '+id.sourceRevision+' '+id.attemptId+'\n'))throw new Error('MIGRATION_COLLECTOR_PREFLIGHT_FAILED');
   const before=await diagnostic();if(JSON.stringify(before)!==JSON.stringify(inputs.plan.ledger))throw new Error('MIGRATION_DIAGNOSTIC_BASELINE_LEDGER_CHANGED');
   const admissionRoot=`/var/lib/workspacex-cn/preflight-receipts/${id.sourceRevision}/${id.attemptId}`;
   verifyBaselineMigrationAdmission(runtime.read(admissionRoot+'/prebuild.json'),runtime.read(admissionRoot+'/prebuild.validated.json'),id,runtime.now());
   await barrier();startedAt=runtime.now();
   const result=await lifecycle.migrateExactPlan(id);
   await barrier();completed=true;return result;
  },
  readFreshCompletion:async()=>{
   if(!completed||startedAt===undefined)throw new Error('MIGRATION_COMPLETION_BEFORE_MIGRATION');
   await barrier();const liveLedger=await diagnostic();const result=await runtime.runBash(binding.collector,['--maintenance-completion',id.sourceRevision,id.attemptId,id.migrationPlanSha256]);
   const value=JSON.parse(result.stdout);
   if(value.schemaVersion!==1||typeof value.providerResponseBase64!=='string'||!hex.safeParse(value.providerResponseSha256).success)throw new Error('MIGRATION_PROVIDER_RESPONSE_INVALID');
   const raw=Buffer.from(value.providerResponseBase64,'base64');if(raw.toString('base64')!==value.providerResponseBase64||createHash('sha256').update(raw).digest('hex')!==value.providerResponseSha256)throw new Error('MIGRATION_PROVIDER_RESPONSE_INVALID');
   const actual=JSON.parse(raw.toString('utf8'));const finished=Date.parse(actual.Invocation?.InvocationResults?.InvocationResult?.[0]?.FinishedTime);if(!Number.isFinite(finished)||finished<startedAt||finished>runtime.now())throw new Error('MIGRATION_COMPLETION_NOT_FROM_THIS_EXECUTION');
   const intended=JSON.parse(runtime.read(binding.completionPath).toString('utf8'));
   if(JSON.stringify(intended.expected)!==JSON.stringify(inputs.expectedCompletion))throw new Error('MIGRATION_COMPLETION_EXPECTED_CHANGED');
   const snapshot={schemaVersion:2,kind:'cn-readonly-migration-snapshot',capturedAt:new Date(runtime.now()).toISOString(),source,fullResponseBase64:value.providerResponseBase64,fullResponseSha256:value.providerResponseSha256};
   const sourceBinding={schemaVersion:2,source,sourceEvidence:intended.sourceEvidence,cloud:value.cloud};const validated=validateMigrationSnapshot(snapshot,sourceBinding);if(JSON.stringify(validated.ledger)!==JSON.stringify(liveLedger))throw new Error('MIGRATION_PROVIDER_DIAGNOSTIC_LEDGER_MISMATCH');
   await barrier();
   const witness=readNativeCompletion(await runtime.verifyCompletion(snapshot,sourceBinding,inputs.checkout,inputs.expectedCompletion,new Date(runtime.now())),id,runtime.now());
   const receiptPath=binding.completionPath.replace(/\.json$/,'.completed.json');
   const bytes=Buffer.from(JSON.stringify(witness)+'\n');
   const receipt={path:receiptPath,sha256:createHash('sha256').update(bytes).digest('hex')};
   await lifecycle.recordMigrationCompletion(id,'intent',receipt);await runtime.persist(receiptPath,bytes);await lifecycle.recordMigrationCompletion(id,'durable',receipt);
   await barrier();return {snapshot,binding:sourceBinding};
  },
 };
}
export function boundExactMigrationAction(inputs:ExactMigrationInputs,binding:MigrationHostBinding,runWriter:CommandRunner,lifecycle:PersistentMigrationLifecycle){return exactMigrationAction(inputs,createMigrationTransport(inputs,binding,runWriter,lifecycle));}

/** Atomic no-overwrite publication; fixture ownership override is not CLI input.
 * A crash leaving the temporary hardlink makes nlink=2 and readers fail closed. */
export function publishMigrationReceipt(path:string,bytes:Buffer,fixture?:{uid:number;gid:number;boundary:string}):void{
 if(!fixture&&!/^\/etc\/workspacex-cn\/migration-completion-inputs\/9b25bfa65662b96c0826fe67506b562ea46aa6d0\/[A-Za-z0-9-]{1,128}\.completed\.json$/.test(path))throw new Error('MIGRATION_RECEIPT_PATH');
 if(bytes.length>8*1024*1024)throw new Error('MIGRATION_RECEIPT_BOUND');
 const uid=fixture?.uid??0,gid=fixture?.gid??0;const parent=dirname(path);
 for(let directory=parent;;directory=dirname(directory)){const info=lstatSync(directory);if(!info.isDirectory()||info.uid!==uid||info.gid!==gid||(info.mode&0o022))throw new Error('MIGRATION_RECEIPT_PARENT');if(directory===(fixture?.boundary??'/'))break;}
 const directory=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const temporary=path+'.'+process.pid+'.'+randomUUID()+'.tmp';let published=false;
 try{const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{const st=fstatSync(fd);if(st.uid!==uid||st.gid!==gid||st.nlink!==1)throw new Error('MIGRATION_RECEIPT_OWNER');writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  // link is the atomic exclusive publish operation; it never replaces a receipt.
  linkSync(temporary,path);published=true;unlinkSync(temporary);fsyncSync(directory);
  const st=lstatSync(path);if(!st.isFile()||st.uid!==uid||st.gid!==gid||st.nlink!==1||(st.mode&0o777)!==0o600)throw new Error('MIGRATION_RECEIPT_READBACK');
 }catch(error){if(!published){try{unlinkSync(temporary);}catch{/* only this unique temp */}}throw error;}finally{closeSync(directory);}
}
