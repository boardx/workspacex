import {createHash} from "node:crypto";
import {PlatformModelTestRequest as Request,PlatformModelTestResult as Result,PlatformModelTestRecord as RecordSchema} from "@repo/contracts/platform-model-test";
import type {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {IdentityRepository} from "../../application/identity/ports";
import {toOrgId,type OrgId} from "../../domain/org-id";
import {PlatformModelTestError,type PlatformModelTestActor,type PlatformModelTestOperation,type PlatformModelTestRepository} from "../../application/model/platform-model-test-ports";
import {coreModelScopedDb} from "./pg-org-core-model-repository";
interface Row {id:string;org_id:string;operator_user_id:string;request:unknown;input_hash:string;state:PlatformModelTestOperation["state"];settlement_state:PlatformModelTestOperation["settlementState"];result:unknown;failure_reason:PlatformModelTestOperation["failureReason"];physical_receipt_id:string|null;}
export interface PlatformModelTestRepositoryAuthority {
 readonly isOperator:(userId:string,scopedDb:DatabasePort,orgId:OrgId)=>Promise<boolean>;
 readonly identities:(scopedDb:DatabasePort)=>IdentityRepository;
}
export interface PlatformModelTestAccountingMetadata {
 readonly orgId:OrgId;readonly operatorUserId:string;readonly testId:string;
 readonly state:PlatformModelTestOperation["state"];readonly settlementState:PlatformModelTestOperation["settlementState"];
 readonly physicalReceiptId:string|null;
}
function canonical(value:unknown):string {
 if(value===null||typeof value!=="object")return JSON.stringify(value)??"null";
 if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
 const object=value as Record<string,unknown>;
 return `{${Object.keys(object).filter(key=>object[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
const resultKinds={text:"text","image-generation":"image","text-to-speech":"audio","speech-to-text":"text",embedding:"embedding",rerank:"rerank"} as const;
const hash=(request:PlatformModelTestRequest)=>createHash("sha256").update(canonical(request)).digest("hex");
function operation(row:Row):PlatformModelTestOperation {
 const parsed=Request.safeParse(row.request),parsedResult=Result.nullable().safeParse(row.result);
 if(!parsed.success||!parsedResult.success||!RecordSchema.shape.state.safeParse(row.state).success
  ||!RecordSchema.shape.settlementState.safeParse(row.settlement_state).success||!RecordSchema.shape.failureReason.safeParse(row.failure_reason).success)
  throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
 const request=parsed.data,result=parsedResult.data;
 if(request.orgId!==row.org_id||request.testId!==row.id||hash(request)!==row.input_hash
  ||(result!==null&&(row.state!=="succeeded"||result.kind!==resultKinds[request.capability]))
  ||(row.state==="succeeded"&&(result===null||row.failure_reason!==null)))throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
 return {testId:row.id,operatorUserId:row.operator_user_id,request,state:row.state,settlementState:row.settlement_state,result,failureReason:row.failure_reason};
}
const columns="id,org_id,operator_user_id,request,input_hash,state,settlement_state,result,failure_reason,physical_receipt_id";
export class PgPlatformModelTestRepository implements PlatformModelTestRepository {
 constructor(private readonly db:DatabasePort,private readonly authority:PlatformModelTestRepositoryAuthority){}
 private async authorized<T>(actor:PlatformModelTestActor,work:(s:TenantSession,orgId:OrgId)=>Promise<T>):Promise<T>{
  const orgId=toOrgId(actor.orgId);
  return this.db.withTenant(orgId,async s=>{
   await s.query("SELECT pg_advisory_xact_lock(hashtext($1))",[String(orgId)]);
   const scoped=coreModelScopedDb(s,orgId);
   if(!await this.authority.isOperator(actor.operatorUserId,scoped,orgId))throw new PlatformModelTestError("TEST_FORBIDDEN");
   const organization=(await s.query<{kind:string}>("SELECT kind FROM organizations WHERE id=$1 FOR SHARE",[orgId])).rows[0];
   if(organization?.kind!=="organization"||!await this.authority.identities(scoped).findOrgMembership(actor.operatorUserId,orgId))throw new PlatformModelTestError("TEST_FORBIDDEN");
   return work(s,orgId);
  });
 }
 authorizeActor(actor:PlatformModelTestActor):Promise<void>{return this.authorized(actor,async()=>{});}
 private async row(s:TenantSession,orgId:OrgId,actor:PlatformModelTestActor,testId:string,lock=false):Promise<Row>{
  const row=(await s.query<Row>(`SELECT ${columns} FROM platform_model_tests WHERE org_id=$1 AND id=$2::uuid${lock?" FOR UPDATE":""}`,[orgId,testId])).rows[0];
  if(!row||row.operator_user_id!==actor.operatorUserId)throw new PlatformModelTestError("TEST_NOT_FOUND");
  operation(row);return row;
 }
 async claim(actor:PlatformModelTestActor,raw:PlatformModelTestRequest){
  const input=Request.parse(raw);
  if(input.orgId!==actor.orgId)throw new PlatformModelTestError("TEST_FORBIDDEN");
  return this.authorized(actor,async(s,orgId)=>{
   await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify(["platform-model-test",input.testId])]);
   const previous=(await s.query<Row>(`SELECT ${columns} FROM platform_model_tests WHERE org_id=$1 AND id=$2::uuid FOR UPDATE`,[orgId,input.testId])).rows[0];
   if(previous){
    if(previous.operator_user_id!==actor.operatorUserId||previous.input_hash!==hash(input))throw new PlatformModelTestError("TEST_ID_CONFLICT");
    return {operation:operation(previous),claimed:false};
   }
   const inserted=(await s.query<Row>(`INSERT INTO platform_model_tests(id,org_id,operator_user_id,request,input_hash)
    VALUES($1::uuid,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`,[input.testId,orgId,actor.operatorUserId,JSON.stringify(input),hash(input)])).rows[0];
   // A UUID belonging to another RLS tenant is never read through an unscoped connection.
   if(!inserted)throw new PlatformModelTestError("TEST_ID_CONFLICT");
   return {operation:operation(inserted),claimed:true};
  });
 }
 read(actor:PlatformModelTestActor,testId:string){return this.authorized(actor,async(s,orgId)=>operation(await this.row(s,orgId,actor,testId)));}
 beginDispatch(actor:PlatformModelTestActor,testId:string){return this.authorized(actor,async(s,orgId)=>{
  const current=await this.row(s,orgId,actor,testId,true);
  if(current.state!=="queued")return false;
  if(current.physical_receipt_id===null)throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
  const result=await s.query(`UPDATE platform_model_tests SET state='dispatching',updated_at=now() WHERE org_id=$1 AND id=$2::uuid AND state='queued' AND EXISTS(SELECT 1 FROM ai_request_reservations r WHERE r.org_id=$1 AND r.id=platform_model_tests.physical_receipt_id AND r.user_id=platform_model_tests.operator_user_id AND r.state='held') RETURNING id`,[orgId,testId]);
  return result.rows.length===1;
 });}
 async terminal(actor:PlatformModelTestActor,testId:string,input:{state:"succeeded"|"failed"|"unknown";result:PlatformModelTestResult|null;failureReason:string|null}){
  const result=Result.nullable().safeParse(input.result),reason=RecordSchema.shape.failureReason.safeParse(input.failureReason);
  if(!result.success||!reason.success)throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
  const terminal={...input,result:result.data,failureReason:reason.data};
  if(terminal.state==="succeeded"?(terminal.result===null||terminal.failureReason!==null):(terminal.result!==null||terminal.failureReason===null))throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
  return this.authorized(actor,async(s,orgId)=>{
   const current=await this.row(s,orgId,actor,testId,true);
   if(current.state==="cancelled"||current.state==="unknown")return; // Cancellation never resurrects paid work.
   if(current.state==="succeeded"||current.state==="failed"){
    if(canonical([current.state,current.result,current.failure_reason])!==canonical([terminal.state,terminal.result,terminal.failureReason]))throw new PlatformModelTestError("TEST_ID_CONFLICT");
    return;
   }
   if(current.state==="queued"&&terminal.state!=="failed")throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
   if(terminal.result&&terminal.result.kind!==resultKinds[Request.parse(current.request).capability])throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
   await s.query("UPDATE platform_model_tests SET state=$3,result=$4::jsonb,failure_reason=$5,settlement_state=CASE WHEN physical_receipt_id IS NULL THEN settlement_state ELSE 'held' END,updated_at=now() WHERE org_id=$1 AND id=$2::uuid",[orgId,testId,terminal.state,terminal.result===null?null:JSON.stringify(terminal.result),terminal.failureReason]);
  });
 }
 cancel(actor:PlatformModelTestActor,testId:string){return this.authorized(actor,async(s,orgId)=>{
  const current=await this.row(s,orgId,actor,testId,true);
  if(current.state==="queued"||current.state==="dispatching"){
   await s.query("UPDATE platform_model_tests SET state=$3,result=NULL,failure_reason='dispatch-cancelled',settlement_state='held',updated_at=now() WHERE org_id=$1 AND id=$2::uuid",[orgId,testId,current.state==="queued"?"cancelled":"unknown"]);
   return operation(await this.row(s,orgId,actor,testId));
  }
  return operation(current);
 });}
 readAccountingMetadata(actor:PlatformModelTestActor,testId:string):Promise<PlatformModelTestAccountingMetadata>{return this.authorized(actor,async(s,orgId)=>{
  const row=await this.row(s,orgId,actor,testId);
  return {orgId,testId,operatorUserId:row.operator_user_id,state:row.state,settlementState:row.settlement_state,physicalReceiptId:row.physical_receipt_id};
 });}
 /** Reserve and persist start/link atomically while cancellation is fenced by the operation row. */
 withQueuedAccounting<T>(actor:PlatformModelTestActor,testId:string,work:(scoped:DatabasePort,metadata:PlatformModelTestAccountingMetadata)=>Promise<{physicalReceiptId:string;value:T}>):Promise<T>{
  return this.authorized(actor,async(s,orgId)=>{
   const row=await this.row(s,orgId,actor,testId,true);
   if(row.state!=="queued")throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
   const metadata:PlatformModelTestAccountingMetadata={orgId,testId,operatorUserId:row.operator_user_id,state:row.state,settlementState:row.settlement_state,physicalReceiptId:row.physical_receipt_id};
   const result=await work(coreModelScopedDb(s,orgId),metadata);
   if(row.physical_receipt_id!==null&&row.physical_receipt_id!==result.physicalReceiptId)throw new PlatformModelTestError("TEST_ID_CONFLICT");
   await s.query("UPDATE platform_model_tests SET physical_receipt_id=$3,updated_at=now() WHERE org_id=$1 AND id=$2::uuid",[orgId,testId,result.physicalReceiptId]);
   return result.value;
  });
 }
 /** Only trusted accounting after persisting a same-org/member durable start. */
 attachPhysicalReceipt(actor:PlatformModelTestActor,testId:string,physicalReceiptId:string){return this.authorized(actor,async(s,orgId)=>{
  const row=await this.row(s,orgId,actor,testId,true);
  if(row.physical_receipt_id!==null){if(row.physical_receipt_id!==physicalReceiptId)throw new PlatformModelTestError("TEST_ID_CONFLICT");return;}
  if(row.state!=="queued")throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
  await s.query("UPDATE platform_model_tests SET physical_receipt_id=$3,updated_at=now() WHERE org_id=$1 AND id=$2::uuid",[orgId,testId,physicalReceiptId]);
 });}
 /** Safe billed quantities only; estimated transport duration is not supplier usage. */
 readUsageProjection(actor:PlatformModelTestActor,testId:string):Promise<import("@repo/contracts/platform-model-test").PlatformModelTestRecord["usage"]>{return this.authorized(actor,async(s,orgId)=>{
  const row=await this.row(s,orgId,actor,testId);
  if(!row.physical_receipt_id)return null;
  const fact=(await s.query<{tokens_total:string;tokens_prompt:string|null;tokens_completion:string|null;total_source:string;native_unit:string|null;native_quantity:string|null;native_source:string|null;cost_micros:string|null;currency:string|null;price_version:string|null}>(`SELECT e.tokens_total::text,e.tokens_prompt::text,e.tokens_completion::text,e.total_source,e.native_unit,e.native_quantity::text,e.native_source,e.cost_micros::text,e.currency,e.price_version
   FROM effective_token_usage() e JOIN ai_request_reservations r ON r.org_id=e.org_id AND r.id=e.id
   JOIN model_request_starts receipt_start ON receipt_start.org_id=e.org_id AND receipt_start.id=e.id
   WHERE e.org_id=$1 AND e.id=$2 AND e.user_id=$3 AND r.user_id=$3 AND receipt_start.user_id=$3
    AND e.model_provider=r.model_provider AND e.model_id=r.model_id AND receipt_start.model_provider=r.model_provider AND receipt_start.model_id=r.model_id
    AND receipt_start.platform_test_id=$4::uuid AND r.formal_model_id=$5
    AND (e.cost_micros IS NULL OR (e.currency=r.currency AND e.price_version=r.price_version))`,[orgId,row.physical_receipt_id,row.operator_user_id,testId,operation(row).request.modelId])).rows[0];
  if(!fact)return null;
  const parsed=RecordSchema.shape.usage.safeParse({tokens:fact.total_source==="reported"?String(fact.tokens_total):null,nativeUnit:fact.native_unit,
   inputTokens:fact.tokens_prompt==null?null:String(fact.tokens_prompt),outputTokens:fact.tokens_completion==null?null:String(fact.tokens_completion),
   nativeQuantity:fact.native_source==="reported"&&fact.native_quantity!==null?String(fact.native_quantity):null,
   costMicros:fact.cost_micros===null?null:String(fact.cost_micros),currency:fact.currency,priceVersion:fact.price_version});
  if(!parsed.success)throw new PlatformModelTestError("TEST_ACCOUNTING_UNAVAILABLE");
  return parsed.data;
 });}
 /** No caller can label a test paid: project the actual matching reservation and receipt. */
 refreshSettlement(actor:PlatformModelTestActor,testId:string){return this.authorized(actor,async(s,orgId)=>{
  const row=await this.row(s,orgId,actor,testId,true);
  if(!row.physical_receipt_id)return;
  const ledger=(await s.query<{state:string;user_id:string;settled_tokens:string|null;settled_cost_micros:string|null;tokens_total:string;total_source:string;native_source:string|null;native_quantity:string|null;cost_micros:string|null;currency:string;reserved_currency:string;price_version:string;reserved_price_version:string}>(`SELECT r.state,r.user_id,r.settled_tokens,r.settled_cost_micros,e.tokens_total,e.total_source,e.native_source,e.native_quantity,e.cost_micros,e.currency,r.currency AS reserved_currency,e.price_version,r.price_version AS reserved_price_version
   FROM ai_request_reservations r JOIN effective_token_usage() e ON e.org_id=r.org_id AND e.id=r.id
   JOIN model_request_starts receipt_start ON receipt_start.org_id=r.org_id AND receipt_start.id=r.id
   WHERE r.org_id=$1 AND r.id=$2 AND e.user_id=r.user_id AND e.model_provider=r.model_provider AND e.model_id=r.model_id
    AND receipt_start.platform_test_id=$3::uuid AND receipt_start.user_id=r.user_id AND r.formal_model_id=$4`,[orgId,row.physical_receipt_id,testId,operation(row).request.modelId])).rows[0];
  const known=ledger?.state==="settled"&&ledger.user_id===actor.operatorUserId&&ledger.settled_tokens!==null&&ledger.settled_cost_micros!==null
   &&(ledger.total_source==="reported"||(ledger.total_source==="not-applicable"&&ledger.native_source==="reported"&&ledger.native_quantity!==null))
   &&ledger.cost_micros!==null&&ledger.settled_tokens===String(ledger.tokens_total)&&ledger.settled_cost_micros===String(ledger.cost_micros)
   &&ledger.currency===ledger.reserved_currency&&ledger.price_version===ledger.reserved_price_version;
  await s.query("UPDATE platform_model_tests SET settlement_state=$3,updated_at=now() WHERE org_id=$1 AND id=$2::uuid",[orgId,testId,known?"settled":"held"]);
 });}
}
