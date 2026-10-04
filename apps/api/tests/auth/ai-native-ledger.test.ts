import {describe,it,expect,vi} from "vitest";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgAsrUsageMeter,configuredAsrUsageMeter} from "../../src/infrastructure/recording/pg-realtime-asr-repository";
import {toOrgId} from "../../src/domain/org-id";
import type {TokenUsageRecord} from "../../src/application/agent-run/ports";
const org=toOrgId("native-org");
const native:TokenUsageRecord={eventId:"native-receipt",userId:"u",runId:null,modelProvider:"provider",modelId:"model",tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:"not-applicable",outcome:"failed",nativeUsage:{unit:"image",quantity:1n,source:"reported"}};
const db=(query:unknown)=>({withTenant:async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});}});
describe("native dimensions in the single immutable AI ledger",()=>{
 it("stores original unit and provenance, with Token explicitly not applicable",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});await new PgTokenUsageRepository(db(query) as never).record(org,native);
  const params=query.mock.calls[0]?.[1];expect(params.slice(24)).toEqual(["image","1","reported"]);expect(params[10]).toBe("not-applicable");expect(params.slice(6,9)).toEqual([0,null,null]);
 });
 it("rejects fake native zero-token reports, native estimates priced as actual and unknown quantities",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]}),repo=new PgTokenUsageRepository(db(query) as never);
  for(const bad of [{...native,totalSource:undefined},{...native,tokensTotal:1},{...native,nativeUsage:{unit:"image",quantity:1n,source:"unknown"}},{...native,costMicros:1n,currency:"CNY",priceVersion:"p",nativeUsage:{unit:"image",quantity:1n,source:"estimated"}}])await expect(repo.record(org,bad as TokenUsageRecord)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
 });
 it("can preserve real provider Tokens and native side dimensions in one receipt",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});await new PgTokenUsageRepository(db(query) as never).record(org,{...native,totalSource:"reported",tokensTotal:12,promptTokens:10,completionTokens:2});
  expect(query.mock.calls[0]?.[1].slice(6,9)).toEqual([12,10,2]);expect(query.mock.calls[0]?.[1].slice(24)).toEqual(["image","1","reported"]);
 });
 it("mirrors actual existing ASR meter to the same tenant transaction as estimated time, never Token or charged cost",async()=>{
  const query=vi.fn().mockImplementation(async(sql:string)=>({rows:sql.includes("INTO realtime_asr_usage_events")?[{provider_task_id:"task"}]:[]}));
  const withTenant=vi.fn(async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});});
  await new PgAsrUsageMeter({withTenant} as never,"verified-asr-route").record({providerTaskId:"task",orgId:org,ownerUserId:"owner",captureId:"capture",model:"actual-model",durationSeconds:2});
  expect(withTenant).toHaveBeenCalledOnce();const write=query.mock.calls.find(call=>call[0].includes("INTO token_usage_events"));expect(write).toBeDefined();
  const params=(write as unknown as [string,unknown[]])[1];expect(params[2]).toBe("owner");expect(params[10]).toBe("not-applicable");expect(params[18]).toBeNull();expect(params.slice(24)).toEqual(["millisecond","2000","estimated"]);
 });
 it("foreign/mismatched ASR replay cannot mint another native receipt",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});await expect(new PgAsrUsageMeter(db(query) as never,"route").record({providerTaskId:"foreign",orgId:org,ownerUserId:"owner",captureId:"capture",model:"m",durationSeconds:1})).rejects.toThrow("ASR_USAGE_REPLAY_MISMATCH");
  expect(query.mock.calls.some(call=>call[0].includes("INTO token_usage_events"))).toBe(false);
 });
 it("actual-WS accounting disables only legacy ledger mirror and preserves legacy usage event",async()=>{
  for(const actual of ["1",undefined]){
   const query=vi.fn().mockImplementation(async(sql:string)=>({rows:sql.includes("INTO realtime_asr_usage_events")?[{provider_task_id:"task"}]:[]}));
   await configuredAsrUsageMeter(db(query) as never,{KERNEL_NATIVE_USAGE_LEDGER_ENABLED:"1",KERNEL_ASR_REQUEST_ACCOUNTING_ENABLED:actual,KERNEL_ASR_PROVIDER:"configured",KERNEL_ASR_MODEL:"model"}).record({providerTaskId:"task",orgId:org,ownerUserId:"owner",captureId:"capture",model:"model",durationSeconds:2});
   expect(query.mock.calls.filter(c=>c[0].includes("INTO realtime_asr_usage_events"))).toHaveLength(1);
   expect(query.mock.calls.filter(c=>c[0].includes("INTO token_usage_events"))).toHaveLength(actual==="1"?0:1);
  }
 });

});
