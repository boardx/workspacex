import {createHash,randomUUID} from "node:crypto";
import {mkdir,open,readdir,readFile,unlink,lstat,link,rmdir} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {resolve,join} from "node:path";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../../application/agent-run/ports";
import type {OrgId} from "../../domain/org-id";
import {toOrgId} from "../../domain/org-id";
import {CreditConsumptionError} from "../../application/billing/credit-consumption";
type Start=Parameters<NonNullable<TokenUsageMeterPort["startRequest"]>>[1];
type Receipt={version:1;orgId:OrgId;usage:TokenUsageRecord};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>typeof v==="bigint"?{$creditBigint:v.toString()}:v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function parse(value:string):Receipt {
 const obj:unknown=JSON.parse(value,(_key,v)=>v&&typeof v==="object"&&Object.keys(v).length===1&&typeof v.$creditBigint==="string"&&/^\d{1,19}$/.test(v.$creditBigint)?BigInt(v.$creditBigint):v);
 if(!obj||typeof obj!=="object")throw new Error("invalid_credit_spool_receipt");
 const r=obj as Receipt,u=r.usage;
 if(r.version!==1||!u||typeof u.eventId!=="string"||!u.eventId||typeof u.userId!=="string"||!u.userId||typeof u.modelProvider!=="string"||typeof u.modelId!=="string"||!Number.isSafeInteger(u.tokensTotal)||u.tokensTotal<0||!["succeeded","failed"].includes(u.outcome)||!(u.runId===null||typeof u.runId==="string"))throw new Error("invalid_credit_spool_receipt");
 toOrgId(r.orgId);
 if(u.costMicros!==undefined&&(typeof u.costMicros!=="bigint"||u.costMicros<0n))throw new Error("invalid_credit_spool_cost");
 if(u.nativeUsage&&u.nativeUsage.quantity!==null&&(typeof u.nativeUsage.quantity!=="bigint"||u.nativeUsage.quantity<0n))throw new Error("invalid_credit_spool_native");
 return r;
}
/**
 * Private fsync-backed outbox. Stores usage metadata only, never provider bodies,
 * prompts or credentials. A deploy MUST mount directory on persistent local storage.
 * Uncertain start slots never expire: operators reconcile them rather than erase holds.
 */
export class DurableCreditUsageMeter implements TokenUsageMeterPort {
 readonly directory:string;
 private readonly maximum:number;
 private replaying=false;
 private readonly retainUntilReplay:boolean;
 constructor(private readonly delegate:TokenUsageMeterPort,options:{directory?:string;maxPending?:number;retainUntilReplay?:boolean}={}){
  this.directory=resolve(options.directory??process.env.WORKSPACEX_CREDIT_RECEIPT_DIR??join(process.cwd(),".harness/state/.cache/credit-receipts"));
  this.maximum=options.maxPending??10000;
  this.retainUntilReplay=options.retainUntilReplay??true;
  if(!Number.isSafeInteger(this.maximum)||this.maximum<1)throw new Error("invalid_credit_spool_capacity");
 }
 private key(id:string){return createHash("sha256").update(id).digest("hex");}
 private unavailable(org:OrgId,message="credit_receipt_store_unavailable"){return new CreditConsumptionError("credit_accounting_unavailable","team",org,message);}
 private async directoryReady(){
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const stat=await lstat(this.directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error("credit_spool_directory_not_private");
 }
 private async syncDirectory(){const handle=await open(this.directory,"r");try{await handle.sync();}finally{await handle.close();}}
 private async atomicFile(path:string,contents:string){
  const temp=join(this.directory,`.${randomUUID()}.tmp`);
  const handle=await open(temp,"wx",0o600);
  try{await handle.writeFile(contents,"utf8");await handle.sync();}catch(error){await unlink(temp).catch(()=>undefined);throw error;}finally{await handle.close();}
  try{try{await link(temp,path);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;if(await readFile(path,"utf8")!==contents)throw new Error("credit_spool_replay_mismatch");}await this.syncDirectory();}
  finally{await unlink(temp).catch(()=>undefined);}
 }
 async prepareStart(orgId:OrgId,input:Start):Promise<void>{
  const slot=join(this.directory,`${this.key(input.requestId)}.reserved`),lock=join(this.directory,".admission-lock");
  let locked=false;
  try{
   await this.directoryReady();
   const deadline=Date.now()+5000;
   while(!locked){try{await mkdir(lock,{mode:0o700});locked=true;}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST"||Date.now()>=deadline)throw error;await delay(20);}}
   const names=await readdir(this.directory),keys=new Set(names.filter(n=>/^[a-f0-9]{64}\.(reserved|json)$/.test(n)).map(n=>n.slice(0,64)));
   if(!keys.has(this.key(input.requestId))&&keys.size>=this.maximum)throw new Error("credit_spool_capacity_exhausted");
   // Minimal immutable subject; bounds and prices are authoritative in PostgreSQL.
   await this.atomicFile(slot,canonical({orgId,userId:input.userId,requestId:input.requestId,modelProvider:input.modelProvider,modelId:input.modelId}));
  }catch{throw this.unavailable(orgId);}finally{if(locked)await rmdir(lock).catch(()=>undefined);}
 }
 /** Only a confirmed nondispatch path may discard its local admission slot. */
 async discardPreparedStart(orgId:OrgId,input:Start):Promise<void>{
  const key=this.key(input.requestId),slot=join(this.directory,`${key}.reserved`);
  try{await lstat(join(this.directory,`${key}.json`));return;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw this.unavailable(orgId);}
  try{const expected=canonical({orgId,userId:input.userId,requestId:input.requestId,modelProvider:input.modelProvider,modelId:input.modelId});if(await readFile(slot,"utf8")!==expected)throw this.unavailable(orgId,"credit_spool_start_identity_mismatch");await unlink(slot);await this.syncDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 }
 async startRequest(orgId:OrgId,input:Start):Promise<void>{
  await this.prepareStart(orgId,input);
  if(!this.delegate.startRequest)throw this.unavailable(orgId,"credit_start_boundary_missing");
  try{await this.delegate.startRequest(orgId,input);}catch(error){await this.discardPreparedStart(orgId,input).catch(()=>undefined);throw error;}
 }
 async record(orgId:OrgId,usage:TokenUsageRecord):Promise<void>{
  if(!usage.eventId)throw this.unavailable(orgId,"credit_receipt_identity_missing");
  const key=this.key(usage.eventId),file=join(this.directory,`${key}.json`);
  // Whitelist fields; caller additions must never persist prompts or secrets.
  const safe:TokenUsageRecord={eventId:usage.eventId,userId:usage.userId,runId:usage.runId,modelProvider:usage.modelProvider,modelId:usage.modelId,tokensTotal:usage.tokensTotal,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,outcome:usage.outcome,
   ...(usage.totalSource!==undefined?{totalSource:usage.totalSource}:{}),...(usage.nativeUsage?{nativeUsage:{unit:usage.nativeUsage.unit,quantity:usage.nativeUsage.quantity,source:usage.nativeUsage.source}}:{}),
   ...(usage.costMicros!==undefined?{costMicros:usage.costMicros,currency:usage.currency,priceVersion:usage.priceVersion}:{}),...(usage.projectId!==undefined?{projectId:usage.projectId}:{}),...(usage.threadId!==undefined?{threadId:usage.threadId}:{}),...(usage.agentId!==undefined?{agentId:usage.agentId}:{}),...(usage.callPurpose!==undefined?{callPurpose:usage.callPurpose}:{}),...(usage.executionAttemptId!==undefined?{executionAttemptId:usage.executionAttemptId}:{}),...(usage.subtaskId!==undefined?{subtaskId:usage.subtaskId}:{}),...(usage.requestStartedAt!==undefined?{requestStartedAt:usage.requestStartedAt}:{}),...(usage.requestEndedAt!==undefined?{requestEndedAt:usage.requestEndedAt}:{}),...(usage.cacheInputTokens!==undefined?{cacheInputTokens:usage.cacheInputTokens}:{}),...(usage.reasoningOutputTokens!==undefined?{reasoningOutputTokens:usage.reasoningOutputTokens}:{})};
  try{await this.directoryReady();const contents=canonical({version:1,orgId,usage:safe});if(Buffer.byteLength(contents)>65536)throw new Error("credit_spool_receipt_too_large");parse(contents);await this.atomicFile(file,contents);}catch{throw this.unavailable(orgId);}
  // A failure leaves the fsynced receipt for replay, never re-executes the model.
  await this.delegate.record(orgId,safe);
  // Scoped delegates may only have returned from a nested transaction; the root
  // replay worker independently commits before acknowledging these receipts.
  if(!this.retainUntilReplay)await this.acknowledge(key);
 }
 private async acknowledge(key:string){await unlink(join(this.directory,`${key}.json`)).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});await unlink(join(this.directory,`${key}.reserved`)).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});await this.syncDirectory();}
 async replayPending():Promise<{settled:number;pending:number}>{
  if(this.replaying)return {settled:0,pending:0};this.replaying=true;
  let settled=0,pending=0;
  try{await this.directoryReady();const files=(await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));for(const file of files){try{const r=parse(await readFile(join(this.directory,file),"utf8"));if(this.key(r.usage.eventId!)!==file.slice(0,64))throw new Error("credit_spool_filename_mismatch");await this.delegate.record(r.orgId,r.usage);await this.acknowledge(file.slice(0,64));settled++;}catch{pending++;}}return {settled,pending};}finally{this.replaying=false;}
 }
}
