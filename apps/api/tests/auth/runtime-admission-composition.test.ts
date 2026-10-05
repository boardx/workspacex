import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {PgRuntimeModelUsageRepository} from "../../src/infrastructure/auth/pg-runtime-model-usage-repository";
import {VerifiedModelBoundRegistry} from "../../src/application/agent-run/verified-model-bound-registry";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("org-runtime-admit"),requestId="c4dc228b-ed70-443c-baf0-2e8856b32e1a";
const config={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"100",currency:"CNY",prices:[{modelId:"formal",modelProvider:"route",runtimeModelId:"actual",inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"1000000",cachedInputMicrosPerMillion:"1000000",maxInputTokens:10,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1};
function fixture(child=false,warning=false,selection?:import("../../src/infrastructure/auth/pg-runtime-model-usage-repository").RuntimeAiAdmissionOptions["selection"],degrade=false,confidentiality:"confidential"|"non-confidential"|"unknown"="non-confidential",bindingVerified=true){
 const configuration=degrade?{...config,maxAttempts:2,fallbackModelIds:["cheap"],prices:[...config.prices,{...config.prices[0]!,modelId:"cheap",runtimeModelId:"actual-cheap",maxOutputTokens:3,inputMicrosPerMillion:"500000",outputMicrosPerMillion:"500000",cachedInputMicrosPerMillion:"500000"}],tokenControls:{quotaSource:"organization-template",warningAtTokens:"1",degradeAtTokens:"1",memberOverrides:[]}}:config;
 const owner={user_id:"trusted-author",project_id:"project",thread_id:"thread",agent_id:"agent",root_run_id:"root",subtask_id:child?"child":null};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql.includes("FROM agent_runs"))return {rows:child?[]:[owner]};
  if(sql.includes("FROM subtask_runs"))return {rows:child?[owner]:[]};
  if(sql.includes("FROM organizations"))return {rows:[{id:org}]};
  if(sql.includes("FROM org_memberships"))return {rows:[{member:1}]};
  if(sql.includes("FROM organization_plans"))return {rows:[{plan:"ordinary"}]};
  if((sql.includes("FROM organization_ai_policies")||sql.includes("FROM organization_ai_policy_changes")))return {rows:[{configuration:degrade?configuration:warning?{...config,tokenControls:{quotaSource:"organization-template",warningAtTokens:"1",degradeAtTokens:null,memberOverrides:[]}}:config,price_version:"audited-v1",updated_by:"operator"}]};
  if(sql.includes(" AS active"))return {rows:[{active:true}]};
  if(sql.includes("SELECT token_limit"))return {rows:[{token_limit:"100",cost_limit_micros:"100",currency:"CNY",price_version:"audited-v1"}]};
  if(sql.includes("FROM effective_token_usage()"))return {rows:[{tokens:warning?"1":"0",cost:"0",unknown_tokens:"0",unknown_cost:"0"}]};
  if(sql.includes("COALESCE(sum(GREATEST(r.maximum_tokens"))return {rows:[{tokens:"0",cost:"0"}]};
  if(sql.includes("INSERT INTO model_request_starts"))return {rows:[{id:requestId}]};
  return {rows:[]};
 });
 const withTenant=vi.fn(async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});});
 const model={supportsRequestAccounting:()=>true,supportsDispatchAdmission:()=>true,complete:vi.fn()};
 const registry=new VerifiedModelBoundRegistry(model,configuration.prices.map(price=>({billingUnit:"token",implementation:"fixture",version:"1",artifactSha256:"a".repeat(64),source:"provider-count",verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>2,binding:{modelId:price.modelId,modelProvider:"route",runtimeModelId:price.runtimeModelId,capabilityTags:[],contextWindow:100,maxOutputTokens:price.maxOutputTokens,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}})));
 const pool={listForOrg:vi.fn().mockResolvedValue(configuration.prices.map(price=>({row:{modelId:price.modelId,kind:"closed-api",shape:"single",status:"已启用",complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]}})))};
 const deps={selection,verifyReplacementBinding:async()=>bindingVerified,dependencies:()=>({model,currentCandidates:()=>registry.currentCandidates(pool as never,String(org)),measure:(request:Parameters<typeof registry.measure>[0])=>registry.measure(request)}),primaryModelId:(id:string)=>registry.formalModelId("route",id),facts:async()=>({confidentiality,requiredCapabilities:[]})};
 const repo=new PgRuntimeModelUsageRepository({withTenant} as never,{record:vi.fn()} as never,undefined,deps);
 const input={requestId,attemptId:child?"child:1":"root:1",leaseEpoch:1,startedAt:"2026-10-04T01:00:00Z",modelId:"actual",callPurpose:"primary" as const,logicalCallId:child?"child-logical":"root-logical",serializedBody:JSON.stringify({model:"actual",max_tokens:5,messages:[{role:"user",content:"transient-only"}]}),outputTokenLimit:5};
 input.logicalCallId=JSON.stringify([child?"child":"root",input.callPurpose,input.requestId,createHash("sha256").update(input.serializedBody).digest("hex")]);
 return {repo,input,query,withTenant,model,pool};
}
describe("private root/child same-transaction admission composition",()=>{
 it("a private chat warning without delivery cannot create a durable start",async()=>{
  const f=fixture(false,true);
  await expect(f.repo.admitRuntimeRequest(org,"root",f.input)).rejects.toThrow("AI_WARNING_DELIVERY_UNAVAILABLE");
  expect(f.query.mock.calls.some(call=>call[0].includes("INSERT INTO model_request_starts"))).toBe(false);
  expect(f.model.complete).not.toHaveBeenCalled();
 });
 for(const child of [false,true])it(`${child?"child":"root"} delivers a trusted warning before durable start and admission acknowledgement`,async()=>{
  let f:ReturnType<typeof fixture>;
  const selection=vi.fn(async(tenant,runId,notice,scoped)=>{
   expect(tenant).toBe(org);expect(runId).toBe("root");
   expect(notice).toEqual({logicalCallId:f.input.logicalCallId,logicalAttempt:0,modelId:"formal",modelProvider:"route",runtimeModelId:"actual",fallbackUsed:false,notice:"token-warning"});
   expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO ai_request_reservations"))).toBe(true);
   expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(false);
   await expect(scoped.withTenant(toOrgId("foreign"),async()=>undefined)).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");
  });
  f=fixture(child,true,selection);
  await f.repo.admitRuntimeRequest(org,child?"child":"root",f.input);
  expect(selection).toHaveBeenCalledOnce();expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(true);
 });
 it("a failed configured warning refuses without a durable start",async()=>{
  const selection=vi.fn().mockRejectedValue(new Error("warning_delivery_failed")),f=fixture(false,true,selection);
  await expect(f.repo.admitRuntimeRequest(org,"root",f.input)).rejects.toThrow("warning_delivery_failed");
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(false);
 });
 it("no warning sends no notice",async()=>{
  const selection=vi.fn(),f=fixture(false,false,selection);
  await f.repo.admitRuntimeRequest(org,"root",f.input);expect(selection).not.toHaveBeenCalled();
 });
 it("a configured cheaper same-provider replacement is remeasured/reserved before the only start",async()=>{
  const selection=vi.fn(),f=fixture(false,true,selection,true);
  const dispatch=await f.repo.admitRuntimeRequest(org,"root",f.input);
  expect(dispatch).toEqual({modelId:"actual-cheap",outputTokenLimit:3,serializedBody:JSON.stringify({model:"actual-cheap",max_tokens:3,messages:[{role:"user",content:"transient-only"}]})});
  expect(selection.mock.calls.map(call=>call[2].notice)).toEqual(["quota-degradation","token-warning"]);
  const starts=f.query.mock.calls.filter(([sql])=>sql.includes("INSERT INTO model_request_starts"));
  expect(starts).toHaveLength(1);expect(starts[0]![1]![7]).toBe("actual-cheap");
  const reservations=f.query.mock.calls.filter(([sql])=>sql.includes("INSERT INTO ai_request_reservations"));
  expect(reservations).toHaveLength(1);expect(reservations[0]![1]![11]).toBe(f.input.logicalCallId);
  expect(f.model.complete).not.toHaveBeenCalled();
 });
 for(const confidentiality of ["confidential","unknown"] as const)it(`${confidentiality} is never quota-degraded`,async()=>{
  const selection=vi.fn(),f=fixture(false,true,selection,true,confidentiality);
  await expect(f.repo.admitRuntimeRequest(org,"root",f.input)).rejects.toThrow();
  expect(selection).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(false);
 });
 it("degradation without delivery refuses the selected start",async()=>{
  const f=fixture(false,true,undefined,true);
  await expect(f.repo.admitRuntimeRequest(org,"root",f.input)).rejects.toThrow("AI_WARNING_DELIVERY_UNAVAILABLE");
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(false);
 });
 it("a different physical request cannot reuse another request's logical identity",async()=>{
  const f=fixture();
  await expect(f.repo.admitRuntimeRequest(org,"root",{...f.input,requestId:"8f885d43-e07f-4419-b287-a2c9e7496b18"})).rejects.toThrow("AI_LOGICAL_CALL_IDENTITY_MISMATCH");
  expect(f.withTenant).not.toHaveBeenCalled();
 });
 it("equal-body independent calls get separate reservation identities",async()=>{
  const f=fixture();
  const second={...f.input,requestId:"8f885d43-e07f-4419-b287-a2c9e7496b18"};
  second.logicalCallId=JSON.stringify(["root",second.callPurpose,second.requestId,createHash("sha256").update(second.serializedBody).digest("hex")]);
  await f.repo.admitRuntimeRequest(org,"root",f.input);
  await f.repo.admitRuntimeRequest(org,"root",second);
  expect(f.withTenant).toHaveBeenCalledTimes(2);
  const reserves=f.query.mock.calls.filter(call=>call[0].includes("INSERT INTO ai_request_reservations"));
  expect(reserves).toHaveLength(2);
  expect(reserves.map(call=>call[1]?.[11])).toEqual([f.input.logicalCallId,second.logicalCallId]);
  expect(f.model.complete).not.toHaveBeenCalled();
 });
 it("changing logical identity cannot reset attempts or enter the tenant transaction",async()=>{
  const f=fixture();await expect(f.repo.admitRuntimeRequest(org,"root",{...f.input,logicalCallId:"mint-new-slot"})).rejects.toThrow("AI_LOGICAL_CALL_IDENTITY_MISMATCH");
  expect(f.withTenant).not.toHaveBeenCalled();
  await expect(f.repo.startRuntimeRequest(org,"root",f.input)).rejects.toThrow("RUNTIME_AI_ADMISSION_REQUIRED");
 });
 for(const child of [false,true])it(`${child?"child":"root"} binds trusted owner, reserves and persists start in one tenant transaction`,async()=>{
  const f=fixture(child);await f.repo.admitRuntimeRequest(org,child?"child":"root",f.input);
  expect(f.withTenant).toHaveBeenCalledOnce();expect(f.model.complete).not.toHaveBeenCalled();
  const reserve=f.query.mock.calls.find(call=>call[0].includes("INSERT INTO ai_request_reservations"));
  const start=f.query.mock.calls.find(call=>call[0].includes("INSERT INTO model_request_starts"));
  expect(reserve).toBeDefined();expect(start).toBeDefined();expect(f.query.mock.calls.indexOf(reserve!)).toBeLessThan(f.query.mock.calls.indexOf(start!));
  const allParams=f.query.mock.calls.map(call=>(call as unknown as [string,unknown[]])[1]);
  expect(JSON.stringify(allParams)).not.toContain("transient-only");
  expect(f.pool.listForOrg).toHaveBeenCalledWith(String(org));
 });
});

it("a same-provider name without verified SDK endpoint/account cannot authorize replacement",async()=>{
 const selection=vi.fn(),f=fixture(false,true,selection,true,"non-confidential",false);
 await expect(f.repo.admitRuntimeRequest(org,"root",f.input)).rejects.toThrow("AI_PRIVATE_REPLACEMENT_BINDING_UNVERIFIED");
 expect(selection).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO model_request_starts"))).toBe(false);
});
