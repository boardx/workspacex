import {describe,it,expect,vi} from "vitest";
import {PgAiAdmissionRepository} from "../../src/infrastructure/auth/pg-ai-admission-repository";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {toOrgId} from "../../src/domain/org-id";
import type {TokenUsageRecord} from "../../src/application/agent-run/ports";
const org=toOrgId("asr-partial-settlement"),start=new Date("2026-10-01T00:00:00Z"),end=new Date("2026-11-01T00:00:00Z");
const config={window:{start:start.toISOString(),end:end.toISOString(),timezone:"UTC"},ordinaryTokensPerUser:null,costMicrosPerUser:"100",currency:"CNY",prices:[{modelId:"token",modelProvider:"provider",runtimeModelId:"token",inputMicrosPerMillion:"1",outputMicrosPerMillion:"1",cachedInputMicrosPerMillion:"1",maxInputTokens:1,maxOutputTokens:1}],nativePrices:[{modelId:"formal-asr",modelProvider:"provider",runtimeModelId:"qwen3-asr-flash",unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"2000"}],fallbackModelIds:[],maxAttempts:1};
function fixture(billingKind="native"){
 let receipt:Record<string,unknown>|null=null;
 const query=vi.fn(async(sql:string,params:unknown[]=[])=>{
  if(sql.startsWith("INSERT INTO token_usage_events")){receipt={tokens_total:String(params[6]),tokens_prompt:params[7],tokens_completion:params[8],total_source:params[10],cost_micros:params[18],currency:params[19],price_version:params[20],user_id:params[2],model_provider:params[4],model_id:params[5],request_time:new Date(String(params[15])),native_unit:params[24],native_quantity:params[25],native_source:params[26]};return {rows:[]};}
  if(sql.startsWith("SELECT user_id,window_start"))return {rows:[{user_id:"operator",window_start:start,window_end:end}]};
  if(sql.startsWith("SELECT state,settled_tokens"))return {rows:[{state:"held",currency:"CNY",price_version:"immutable-native-price",model_provider:"provider",model_id:"qwen3-asr-flash",billing_kind:billingKind,native_unit:"millisecond",formal_model_id:"formal-asr"}]};
  if(sql.startsWith("SELECT tokens_total"))return {rows:receipt?[receipt]:[]};
  if(sql.startsWith("SELECT configuration"))return {rows:[{configuration:config}]};
  return {rows:[]};
 });
 const db={withTenant:async(tenant:unknown,work:Function)=>{expect(tenant).toBe(org);return work({query});}} as never;
 const terminal:TokenUsageRecord={eventId:"physical-asr",userId:"operator",runId:null,modelProvider:"provider",modelId:"qwen3-asr-flash",tokensTotal:0,totalSource:"not-applicable",promptTokens:null,completionTokens:6,nativeUsage:{unit:"millisecond",quantity:1000n,source:"reported"},costMicros:7n,currency:"CNY",priceVersion:"immutable-native-price",requestStartedAt:"2026-10-05T00:00:00Z",outcome:"succeeded"};
 return {query,usage:new PgTokenUsageRepository(db),admission:new PgAiAdmissionRepository(db),terminal,receipt:()=>receipt};
}
describe("real ASR partial observation does not become Token billing",()=>{
 it("writer preserves output six and native settlement recomputes only immutable millisecond tariff",async()=>{
  const f=fixture();await f.usage.record(org,f.terminal);expect(f.receipt()).toMatchObject({tokens_total:"0",total_source:"not-applicable",tokens_prompt:null,tokens_completion:6,native_quantity:"1000"});
  await f.admission.settle(org,"physical-asr",{tokens:0n,costMicros:7n});
  expect(f.query.mock.calls.find(([sql])=>sql.startsWith("UPDATE ai_request_reservations"))?.[1]).toEqual(["physical-asr","0","7"]);
 });
 it("partial output cannot authorize settlement of a Token tariff reservation",async()=>{
  const f=fixture("token");await f.usage.record(org,f.terminal);await expect(f.admission.settle(org,"physical-asr",{tokens:0n,costMicros:7n})).rejects.toThrow("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");expect(f.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
 });
 it("reported output cannot price an estimated native quantity",async()=>{
  const f=fixture();const {costMicros:_cost,currency:_currency,priceVersion:_price,...unknownCost}=f.terminal;
  await f.usage.record(org,{...unknownCost,nativeUsage:{unit:"millisecond",quantity:1000n,source:"estimated"}});await f.admission.settle(org,"physical-asr",{tokens:0n,costMicros:null});expect(f.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
 });
 it("partial output does not override the immutable native price",async()=>{
  const f=fixture();await f.usage.record(org,{...f.terminal,costMicros:6n});await expect(f.admission.settle(org,"physical-asr",{tokens:0n,costMicros:6n})).rejects.toThrow("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");expect(f.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
 });
});
