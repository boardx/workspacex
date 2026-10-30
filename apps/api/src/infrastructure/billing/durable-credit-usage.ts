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
 if(u.billingReceipt&&(typeof u.billingReceipt.id!=="string"||u.billingReceipt.id.length<1||u.billingReceipt.id.length>200||typeof u.billingReceipt.final!=="boolean"))throw new Error("invalid_credit_spool_receipt_identity");
 return r;
}
/** Diagnostics may fill unknown fields; known quantities and pricing never change. */
function enrichDiagnostics(prior:Receipt,incoming:Receipt):Receipt{
 const merged={...prior.usage} as Record<string,unknown>;
 for(const key of ["promptTokens","completionTokens","cacheInputTokens","reasoningOutputTokens","costMicros","currency","priceVersion"] as const){
  const old=prior.usage[key],next=incoming.usage[key];if(next===undefined||next===null)continue;
  if(old!==undefined&&old!==null&&old!==next)throw new Error("credit_spool_replay_mismatch");merged[key]=next;
 }
 return {...prior,usage:merged as unknown as TokenUsageRecord};
}
/** Immutable versions avoid an ACK deleting facts enriched during a concurrent replay. */
function mergeReceipt(prior:Receipt,incoming:Receipt):Receipt {
 const a=prior.usage,b=incoming.usage;
 const identity=["eventId","userId","runId","modelProvider","modelId","projectId","threadId","agentId","callPurpose","executionAttemptId","subtaskId","requestStartedAt"] as const;
 if(a.billingReceipt||b.billingReceipt){
  if(prior.orgId!==incoming.orgId||identity.some(key=>canonical(a[key]??null)!==canonical(b[key]??null)))throw new Error("credit_spool_replay_mismatch");
  const measure=(u:TokenUsageRecord):bigint|null=>u.totalSource==="reported"?BigInt(u.tokensTotal):u.nativeUsage?.source==="reported"&&u.nativeUsage.quantity!==null?u.nativeUsage.quantity:null;
  const old=measure(a),next=measure(b),oldFinal=a.billingReceipt?.final??true,nextFinal=b.billingReceipt?.final??true;
  if(a.billingReceipt?.id===b.billingReceipt?.id&&(a.totalSource!==b.totalSource||old!==next||oldFinal!==nextFinal||a.outcome!==b.outcome))throw new Error("credit_spool_replay_mismatch");
  if(old!==null&&next!==null&&(a.totalSource!==b.totalSource||a.nativeUsage?.unit!==b.nativeUsage?.unit))throw new Error("credit_spool_replay_mismatch");
  if(oldFinal&&old!==null){if(next!==null&&(next>old||nextFinal&&(next!==old||a.outcome!==b.outcome)))throw new Error("credit_spool_replay_mismatch");return nextFinal&&next!==null?enrichDiagnostics(prior,incoming):prior;}
  if(next===null&&old!==null)return prior;
  if(nextFinal&&old!==null&&next!==null&&next<old)throw new Error("credit_spool_replay_mismatch");
  return old!==null&&next!==null&&old>next?prior:incoming;
 }
 if(prior.orgId!==incoming.orgId||a.outcome!==b.outcome||identity.some(key=>canonical(a[key]??null)!==canonical(b[key]??null)))throw new Error("credit_spool_replay_mismatch");
 const merged={...enrichDiagnostics(prior,incoming).usage} as Record<string,unknown>;
 if(b.totalSource!=="unknown"){
  if(a.totalSource!=="unknown"&&(a.totalSource!==b.totalSource||a.tokensTotal!==b.tokensTotal))throw new Error("credit_spool_replay_mismatch");
  merged.totalSource=b.totalSource;merged.tokensTotal=b.tokensTotal;
 }
 if(b.nativeUsage){
  if(a.nativeUsage&&a.nativeUsage.unit!==b.nativeUsage.unit)throw new Error("credit_spool_replay_mismatch");
  if(a.nativeUsage?.source==="reported"&&b.nativeUsage.source==="reported"&&a.nativeUsage.quantity!==b.nativeUsage.quantity)throw new Error("credit_spool_replay_mismatch");
  if(!a.nativeUsage||a.nativeUsage.source!=="reported"&&b.nativeUsage.source!=="unknown")merged.nativeUsage=b.nativeUsage;
 }
 return {...prior,usage:merged as unknown as TokenUsageRecord};
}
const receiptName=/^[a-f0-9]{64}(?:\.[a-f0-9]{64})?\.json$/;
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
 private readonly requireExplicitDirectory:boolean;
 private readonly explicitlyConfigured:boolean;
 constructor(private readonly delegate:TokenUsageMeterPort,options:{directory?:string;maxPending?:number;retainUntilReplay?:boolean;requireExplicitDirectory?:boolean}={}){
  const configured=options.directory??process.env.WORKSPACEX_CREDIT_RECEIPT_DIR;
  this.explicitlyConfigured=typeof configured==="string"&&configured.trim().length>0;
  this.requireExplicitDirectory=options.requireExplicitDirectory??false;
  this.directory=resolve(configured??join(process.cwd(),".harness/state/.cache/credit-receipts"));
  this.maximum=options.maxPending??10000;
  this.retainUntilReplay=options.retainUntilReplay??true;
  if(!Number.isSafeInteger(this.maximum)||this.maximum<1)throw new Error("invalid_credit_spool_capacity");
 }
 private key(id:string){return createHash("sha256").update(id).digest("hex");}
 private unavailable(org:OrgId,message="credit_receipt_store_unavailable"){return new CreditConsumptionError("credit_accounting_unavailable","team",org,message);}
 private async directoryReady(){
  if(this.requireExplicitDirectory&&!this.explicitlyConfigured)throw new Error("credit_receipt_persistent_directory_unconfigured");
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
   const names=await readdir(this.directory),keys=new Set(names.filter(n=>/^[a-f0-9]{64}\.reserved$/.test(n)||receiptName.test(n)).map(n=>n.slice(0,64)));
   if(!keys.has(this.key(input.requestId))&&keys.size>=this.maximum)throw new Error("credit_spool_capacity_exhausted");
   // Minimal immutable subject; bounds and prices are authoritative in PostgreSQL.
   await this.atomicFile(slot,canonical({orgId,userId:input.userId,requestId:input.requestId,modelProvider:input.modelProvider,modelId:input.modelId}));
  }catch{throw this.unavailable(orgId);}finally{if(locked)await rmdir(lock).catch(()=>undefined);}
 }
 /** Only a confirmed nondispatch path may discard its local admission slot. */
 async discardPreparedStart(orgId:OrgId,input:Start):Promise<void>{
  const key=this.key(input.requestId),slot=join(this.directory,`${key}.reserved`);
  if((await readdir(this.directory)).some(name=>name.startsWith(key)&&receiptName.test(name)))return;
  try{const expected=canonical({orgId,userId:input.userId,requestId:input.requestId,modelProvider:input.modelProvider,modelId:input.modelId});if(await readFile(slot,"utf8")!==expected)throw this.unavailable(orgId,"credit_spool_start_identity_mismatch");await unlink(slot);await this.syncDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 }
 async startRequest(orgId:OrgId,input:Start):Promise<void>{
  await this.prepareStart(orgId,input);
  if(!this.delegate.startRequest)throw this.unavailable(orgId,"credit_start_boundary_missing");
  try{await this.delegate.startRequest(orgId,input);}catch(error){await this.discardPreparedStart(orgId,input).catch(()=>undefined);throw error;}
 }
 async record(orgId:OrgId,usage:TokenUsageRecord):Promise<void>{
  if(!usage.eventId)throw this.unavailable(orgId,"credit_receipt_identity_missing");
  const key=this.key(usage.eventId);
  // Whitelist fields; caller additions must never persist prompts or secrets.
  const safe:TokenUsageRecord={eventId:usage.eventId,userId:usage.userId,runId:usage.runId,modelProvider:usage.modelProvider,modelId:usage.modelId,tokensTotal:usage.tokensTotal,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,outcome:usage.outcome,
   ...(usage.billingReceipt?{billingReceipt:{id:usage.billingReceipt.id,final:usage.billingReceipt.final}}:{}),
   ...(usage.totalSource!==undefined?{totalSource:usage.totalSource}:{}),...(usage.nativeUsage?{nativeUsage:{unit:usage.nativeUsage.unit,quantity:usage.nativeUsage.quantity,source:usage.nativeUsage.source}}:{}),
   ...(usage.costMicros!==undefined?{costMicros:usage.costMicros,currency:usage.currency,priceVersion:usage.priceVersion}:{}),...(usage.projectId!==undefined?{projectId:usage.projectId}:{}),...(usage.threadId!==undefined?{threadId:usage.threadId}:{}),...(usage.agentId!==undefined?{agentId:usage.agentId}:{}),...(usage.callPurpose!==undefined?{callPurpose:usage.callPurpose}:{}),...(usage.executionAttemptId!==undefined?{executionAttemptId:usage.executionAttemptId}:{}),...(usage.subtaskId!==undefined?{subtaskId:usage.subtaskId}:{}),...(usage.requestStartedAt!==undefined?{requestStartedAt:usage.requestStartedAt}:{}),...(usage.requestEndedAt!==undefined?{requestEndedAt:usage.requestEndedAt}:{}),...(usage.cacheInputTokens!==undefined?{cacheInputTokens:usage.cacheInputTokens}:{}),...(usage.reasoningOutputTokens!==undefined?{reasoningOutputTokens:usage.reasoningOutputTokens}:{})};
  let receipt:Receipt={version:1,orgId,usage:safe},acknowledge:string[]=[];
  try{
   await this.directoryReady();
   for(const name of (await readdir(this.directory)).filter(name=>name.startsWith(key)&&receiptName.test(name))){
    try{receipt=mergeReceipt(parse(await readFile(join(this.directory,name),"utf8")),receipt);acknowledge.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   }
   const contents=canonical(receipt);if(Buffer.byteLength(contents)>65536)throw new Error("credit_spool_receipt_too_large");parse(contents);
   const name=`${key}.${createHash("sha256").update(contents).digest("hex")}.json`;
   await this.atomicFile(join(this.directory,name),contents);acknowledge.push(name);
  }catch{throw this.unavailable(orgId);}
  // A failure leaves all fsynced versions for replay, never re-executes the model.
  await this.delegate.record(orgId,receipt.usage);
  // Scoped delegates may only have returned from a nested transaction; the root
  // replay worker independently commits before acknowledging these exact versions.
  if(!this.retainUntilReplay)await this.acknowledge(key,acknowledge);
 }
 private async acknowledge(key:string,files:readonly string[]){
  for(const file of files)await unlink(join(this.directory,file)).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});
  if(!(await readdir(this.directory)).some(name=>name.startsWith(key)&&receiptName.test(name)))await unlink(join(this.directory,`${key}.reserved`)).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});
  await this.syncDirectory();
 }
 async replayPending():Promise<{settled:number;pending:number}>{
  if(this.replaying)return {settled:0,pending:0};this.replaying=true;
  let settled=0,pending=0;
  try{
   await this.directoryReady();
   const groups=new Map<string,string[]>();
   for(const file of (await readdir(this.directory)).filter(n=>receiptName.test(n))){const key=file.slice(0,64);groups.set(key,[...(groups.get(key)??[]),file]);}
   for(const [key,files]of groups){
    try{
     let merged:Receipt|undefined;
     for(const file of files){try{const receipt=parse(await readFile(join(this.directory,file),"utf8"));if(this.key(receipt.usage.eventId!)!==key)throw new Error("credit_spool_filename_mismatch");merged=merged?mergeReceipt(merged,receipt):receipt;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
     if(!merged)continue;
     await this.delegate.record(merged.orgId,merged.usage);await this.acknowledge(key,files);settled++;
    }catch{pending++;}
   }
   return {settled,pending};
  }finally{this.replaying=false;}
 }
}
