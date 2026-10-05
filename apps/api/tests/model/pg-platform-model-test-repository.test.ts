import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {DatabasePort} from "../../src/application/ports/database.port";
import type {IdentityRepository} from "../../src/application/identity/ports";
import type {PlatformModelTestActor} from "../../src/application/model/platform-model-test-ports";
import {PgPlatformModelTestRepository} from "../../src/infrastructure/model/pg-platform-model-test-repository";
const actor={operatorUserId:"operator",orgId:"test-org"} as PlatformModelTestActor&{orgId:string};
const request={testId:"0c479acf-6523-4d3c-84b8-1986a40255aa",orgId:actor.orgId,modelId:"formal-text",capability:"text" as const,declaredNonConfidential:true as const,input:{prompt:"hello"},bounds:{maximumCostMicros:"10",timeoutMs:1000,maxOutputTokens:2}};
type Row={id:string;org_id:string;operator_user_id:string;request:typeof request;input_hash:string;state:string;settlement_state:string;result:unknown;failure_reason:string|null;physical_receipt_id:string|null};
function fixture(){
 let stored:Row|undefined;let ledger:Record<string,unknown>|undefined;let held=true;
 const isOperator=vi.fn(async()=>true),member=vi.fn(async()=>({orgRole:"member"}));
 const query=vi.fn(async(sql:string,params:readonly unknown[]=[])=>{
  if(sql.startsWith("SELECT kind"))return {rows:[{kind:"organization"}]};
  if(sql.startsWith("SELECT e.tokens_total")||sql.startsWith("SELECT r.state"))return {rows:ledger?[ledger]:[]};
  if(sql.startsWith("SELECT id,org_id"))return {rows:stored&&stored.org_id===params[0]&&stored.id===params[1]?[{...stored}]:[]};
  if(sql.startsWith("INSERT INTO platform_model_tests")){
   if(stored)return {rows:[]};
   stored={id:String(params[0]),org_id:String(params[1]),operator_user_id:String(params[2]),request:JSON.parse(String(params[3])),input_hash:String(params[4]),state:"queued",settlement_state:"pending",result:null,failure_reason:null,physical_receipt_id:null};return {rows:[{...stored}]};
  }
  if(sql.startsWith("UPDATE platform_model_tests")&&stored){
   if(sql.includes("state='dispatching'")){if(!held||stored.state!=="queued")return {rows:[]};stored.state="dispatching";return {rows:[{id:stored.id}]};}
   if(sql.includes("physical_receipt_id=$3")){stored.physical_receipt_id=String(params[2]);return {rows:[]};}
   if(sql.includes("settlement_state=$3")){stored.settlement_state=String(params[2]);return {rows:[]};}
   stored.state=String(params[2]);stored.result=sql.includes("result=NULL")?null:params[3]===null?null:JSON.parse(String(params[3]));stored.failure_reason=sql.includes("result=NULL")?"dispatch-cancelled":String(params[4]);
   if(params[4]===null&&!sql.includes("result=NULL"))stored.failure_reason=null;
   if(stored.physical_receipt_id||sql.includes("result=NULL"))stored.settlement_state="held";return {rows:[]};
  }
  return {rows:[]};
 });
 const withoutTenant=vi.fn(async()=>{throw new Error("UNSCOPED_FORBIDDEN");});
 const db={withTenant:vi.fn(async(org:string,work:(s:unknown)=>Promise<unknown>)=>{expect(org).toBe(actor.orgId);return work({query});}),withoutTenant,close:async()=>{}} as DatabasePort;
 const repository=new PgPlatformModelTestRepository(db,{isOperator,identities:()=>({findOrgMembership:member}) as unknown as IdentityRepository});
 return {repository,db,query,isOperator,member,withoutTenant,row:()=>stored!,ledger:(value:Record<string,unknown>)=>{ledger=value;},held:(value:boolean)=>{held=value;}};
}
describe("tenant platform model test repository",()=>{
 it("candidate authorization rechecks membership without creating operations and locks org first",async()=>{
  const f=fixture();await f.repository.authorizeActor(actor);expect(f.row()).toBeUndefined();
  expect(f.query.mock.calls[0]?.[0]).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
  f.member.mockResolvedValue(null as never);await expect(f.repository.authorizeActor(actor)).rejects.toThrow("TEST_FORBIDDEN");
 });
 it("canonical replay only claims once and never reopens completed work",async()=>{
  const f=fixture();expect((await f.repository.claim(actor,request)).claimed).toBe(true);
  expect((await f.repository.claim(actor,{...request,bounds:{maxOutputTokens:2,timeoutMs:1000,maximumCostMicros:"10"}})).claimed).toBe(false);
  expect(f.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO"))).toHaveLength(1);expect(f.withoutTenant).not.toHaveBeenCalled();
 });
 it.each(["operator","membership"])("rejects revoked %s authority before claiming",async denied=>{
  const f=fixture();if(denied==="operator")f.isOperator.mockResolvedValue(false);else f.member.mockResolvedValue(null as never);
  await expect(f.repository.claim(actor,request)).rejects.toThrow("TEST_FORBIDDEN");expect(f.row()).toBeUndefined();
 });
 it("rejects another billed organization supplied by caller",async()=>{const f=fixture();await expect(f.repository.claim(actor,{...request,orgId:"other-org"})).rejects.toThrow("TEST_FORBIDDEN");expect(f.isOperator).not.toHaveBeenCalled();});
 it("same UUID with another body or actor conflicts without leaking existing result",async()=>{
  const f=fixture();await f.repository.claim(actor,request);
  await expect(f.repository.claim(actor,{...request,input:{prompt:"different"}})).rejects.toThrow("TEST_ID_CONFLICT");
  await expect(f.repository.claim({...actor,operatorUserId:"other-member"},request)).rejects.toThrow("TEST_ID_CONFLICT");
  await expect(f.repository.read({...actor,operatorUserId:"other-member"},request.testId)).rejects.toThrow("TEST_NOT_FOUND");
 });
 it("invisible foreign UUID collision is generic and uses no unscoped lookup",async()=>{
  const f=fixture();await f.repository.claim(actor,request);f.row().org_id="other-org";
  await expect(f.repository.claim(actor,request)).rejects.toThrow("TEST_ID_CONFLICT");expect(f.withoutTenant).not.toHaveBeenCalled();
 });
 it("missing physical receipt blocks dispatch",async()=>{const f=fixture();await f.repository.claim(actor,request);await expect(f.repository.beginDispatch(actor,request.testId)).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");expect(f.row().state).toBe("queued");});
 it("scoped accounting, start and sticky link complete together before dispatch CAS",async()=>{
  const f=fixture();await f.repository.claim(actor,request);
  const value=await f.repository.withQueuedAccounting(actor,request.testId,async(scoped,metadata)=>{
   expect(metadata.operatorUserId).toBe(actor.operatorUserId);expect(metadata.physicalReceiptId).toBeNull();
   await expect(scoped.withTenant("other-org" as never,async()=>{})).rejects.toThrow("CORE_MODEL_TENANT_DENIED");
   return {physicalReceiptId:"receipt",value:7};
  });
  expect(value).toBe(7);expect(f.row().physical_receipt_id).toBe("receipt");expect(await f.repository.beginDispatch(actor,request.testId)).toBe(true);expect(await f.repository.beginDispatch(actor,request.testId)).toBe(false);
 });
 it("a receipt without a live held budget still cannot dispatch",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");f.held(false);
  expect(await f.repository.beginDispatch(actor,request.testId)).toBe(false);expect(f.row().state).toBe("queued");
 });
 it("a cancelled queued operation can neither reserve nor dispatch",async()=>{const f=fixture();await f.repository.claim(actor,request);await f.repository.cancel(actor,request.testId);const work=vi.fn();await expect(f.repository.withQueuedAccounting(actor,request.testId,work)).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");expect(work).not.toHaveBeenCalled();expect(await f.repository.beginDispatch(actor,request.testId)).toBe(false);});
 it("cancel after dispatch retains unknown and late success cannot resurrect the result",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");await f.repository.beginDispatch(actor,request.testId);
  expect((await f.repository.cancel(actor,request.testId)).state).toBe("unknown");await f.repository.terminal(actor,request.testId,{state:"succeeded",result:{kind:"text",text:"late"},failureReason:null});
  expect((await f.repository.read(actor,request.testId))).toMatchObject({state:"unknown",settlementState:"held",result:null});
 });
 it("reported completion does not label the cost settled or enable a model",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");await f.repository.beginDispatch(actor,request.testId);
  await f.repository.terminal(actor,request.testId,{state:"succeeded",result:{kind:"text",text:"done"},failureReason:null});
  expect((await f.repository.read(actor,request.testId)).settlementState).toBe("held");expect(f.query.mock.calls.some(([sql])=>sql.includes("UPDATE models"))).toBe(false);
 });
 it("terminal replay keeps the first result immutable",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");await f.repository.beginDispatch(actor,request.testId);
  const terminal={state:"succeeded" as const,result:{kind:"text" as const,text:"first"},failureReason:null};await f.repository.terminal(actor,request.testId,terminal);await f.repository.terminal(actor,request.testId,terminal);
  await expect(f.repository.terminal(actor,request.testId,{...terminal,result:{kind:"text",text:"different"}})).rejects.toThrow("TEST_ID_CONFLICT");
  expect((await f.repository.read(actor,request.testId)).result).toEqual(terminal.result);
 });
 it("safe usage projection does not present estimated duration as supplier usage",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");
  f.ledger({tokens_total:"0",total_source:"not-applicable",native_unit:"millisecond",native_quantity:"1000",native_source:"estimated",cost_micros:null,currency:null,price_version:null});
  expect(await f.repository.readUsageProjection(actor,request.testId)).toEqual({tokens:null,inputTokens:null,outputTokens:null,nativeUnit:"millisecond",nativeQuantity:null,costMicros:null,currency:null,priceVersion:null});
  f.ledger({tokens_total:"0",total_source:"reported",native_unit:null,native_quantity:null,native_source:null,cost_micros:"0",currency:"CNY",price_version:"v1"});
  expect(await f.repository.readUsageProjection(actor,request.testId)).toMatchObject({tokens:"0",costMicros:"0"});
 });
 it("unconfirmed or mismatched ledger never clears a held settlement",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");
  f.ledger({state:"settled",user_id:"foreign-user",settled_tokens:"3",settled_cost_micros:"7",tokens_total:"3",total_source:"reported",cost_micros:"7",currency:"CNY",reserved_currency:"CNY",price_version:"v1",reserved_price_version:"v1"});
  await f.repository.refreshSettlement(actor,request.testId);expect(f.row().settlement_state).toBe("held");
 });
 it("rejects raw provider error and nonmatching capability output",async()=>{
  const f=fixture();await f.repository.claim(actor,request);
  await expect(f.repository.terminal(actor,request.testId,{state:"failed",result:null,failureReason:"credential=secret"})).rejects.toThrow();
  await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");await f.repository.beginDispatch(actor,request.testId);
  await expect(f.repository.terminal(actor,request.testId,{state:"succeeded",result:{kind:"image",assets:[{url:"/fixture.png",mimeType:"image/png"}]},failureReason:null})).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");
 });
 it("public native projection exposes real output partial with total N/A and missing input unknown",async()=>{
  const f=fixture();await f.repository.claim(actor,request);await f.repository.attachPhysicalReceipt(actor,request.testId,"receipt");
  f.ledger({tokens_total:"0",tokens_prompt:null,tokens_completion:"6",total_source:"not-applicable",native_unit:"millisecond",native_quantity:"1000",native_source:"reported",cost_micros:"7",currency:"CNY",price_version:"native-price"});
  expect(await f.repository.readUsageProjection(actor,request.testId)).toMatchObject({tokens:null,inputTokens:null,outputTokens:"6",nativeQuantity:"1000",costMicros:"7"});
 });
 it("corrupt immutable request hash fails closed",async()=>{const f=fixture();await f.repository.claim(actor,request);f.row().input_hash=createHash("sha256").update("forged").digest("hex");await expect(f.repository.read(actor,request.testId)).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");});
});

describe("platform start receipt persistence",()=>{
 it.each([undefined,"0c479acf-6523-4d3c-84b8-1986a40255aa"])("persists optional formal platform provenance %s without fake run identities",async platformTestId=>{
  const query=vi.fn(async()=>({rows:[]}));
  const db={withTenant:async(_org:unknown,work:Function)=>work({query})} as unknown as DatabasePort;
  await new PgTokenUsageRepository(db).startRequest(actor.orgId as never,{requestId:"receipt",userId:actor.operatorUserId,runId:null,executionAttemptId:null,projectId:null,modelProvider:"provider",modelId:"runtime",startedAt:new Date().toISOString(),callPurpose:"primary",...(platformTestId?{platformTestId}:{})});
  const call=query.mock.calls[0] as unknown as [string,unknown[]];
  const baseParameterNames=["requestId","orgId","userId","runId","executionAttemptId","projectId","modelProvider","modelId","startedAt","threadId","agentId","callPurpose","leaseEpoch","subtaskId","artifactOperationId"];
  const expectedParameterNames=platformTestId?[...baseParameterNames,"platformTestId"]:baseParameterNames;
  expect(call[1]).toHaveLength(expectedParameterNames.length);
  expect(call[1].slice(3,6)).toEqual([null,null,null]);
  expect(call[0].includes("platform_test_id")).toBe(Boolean(platformTestId));
  if(platformTestId)expect(call[1].at(-1)).toBe(platformTestId);
 });
});
