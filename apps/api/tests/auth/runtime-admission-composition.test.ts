import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {PgRuntimeModelUsageRepository} from "../../src/infrastructure/auth/pg-runtime-model-usage-repository";
import {VerifiedModelBoundRegistry} from "../../src/application/agent-run/verified-model-bound-registry";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("org-runtime-admit"),requestId="c4dc228b-ed70-443c-baf0-2e8856b32e1a";
const config={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"100",currency:"CNY",prices:[{modelId:"formal",modelProvider:"route",runtimeModelId:"actual",inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"1000000",cachedInputMicrosPerMillion:"1000000",maxInputTokens:10,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1};
function fixture(child=false){
 const owner={user_id:"trusted-author",project_id:"project",thread_id:"thread",agent_id:"agent",root_run_id:"root",subtask_id:child?"child":null};
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes("FROM agent_runs"))return {rows:child?[]:[owner]};
  if(sql.includes("FROM subtask_runs"))return {rows:child?[owner]:[]};
  if(sql.includes("FROM organizations"))return {rows:[{id:org}]};
  if(sql.includes("FROM org_memberships"))return {rows:[{member:1}]};
  if(sql.includes("FROM organization_plans"))return {rows:[{plan:"ordinary"}]};
  if(sql.includes("FROM organization_ai_policies"))return {rows:[{configuration:config,price_version:"audited-v1",updated_by:"operator"}]};
  if(sql.includes(" AS active"))return {rows:[{active:true}]};
  if(sql.includes("SELECT token_limit"))return {rows:[{token_limit:"100",cost_limit_micros:"100",currency:"CNY",price_version:"audited-v1"}]};
  if(sql.includes("FROM effective_token_usage()"))return {rows:[{tokens:"0",cost:"0",unknown_tokens:"0",unknown_cost:"0"}]};
  if(sql.includes("COALESCE(sum(GREATEST(r.maximum_tokens"))return {rows:[{tokens:"0",cost:"0"}]};
  if(sql.includes("INSERT INTO model_request_starts"))return {rows:[{id:requestId}]};
  return {rows:[]};
 });
 const withTenant=vi.fn(async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});});
 const model={supportsRequestAccounting:()=>true,supportsDispatchAdmission:()=>true,complete:vi.fn()};
 const registry=new VerifiedModelBoundRegistry(model,[{billingUnit:"token",implementation:"fixture",version:"1",artifactSha256:"a".repeat(64),source:"provider-count",verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>2,binding:{modelId:"formal",modelProvider:"route",runtimeModelId:"actual",capabilityTags:[],contextWindow:100,maxOutputTokens:10,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}}]);
 const pool={listForOrg:vi.fn().mockResolvedValue([{row:{modelId:"formal",kind:"closed-api",shape:"single",status:"已启用",complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]}}])};
 const deps={dependencies:()=>({model,currentCandidates:()=>registry.currentCandidates(pool as never,String(org)),measure:(request:Parameters<typeof registry.measure>[0])=>registry.measure(request)}),primaryModelId:(id:string)=>registry.formalModelId("route",id),facts:async()=>({confidentiality:"non-confidential" as const,requiredCapabilities:[]})};
 const repo=new PgRuntimeModelUsageRepository({withTenant} as never,{record:vi.fn()} as never,undefined,deps);
 const input={requestId,attemptId:child?"child:1":"root:1",leaseEpoch:1,startedAt:"2026-10-04T01:00:00Z",modelId:"actual",callPurpose:"primary" as const,logicalCallId:child?"child-logical":"root-logical",serializedBody:JSON.stringify({model:"actual",max_tokens:5,messages:[{role:"user",content:"transient-only"}]}),outputTokenLimit:5};
 input.logicalCallId=JSON.stringify([child?"child":"root",input.callPurpose,createHash("sha256").update(input.serializedBody).digest("hex")]);
 return {repo,input,query,withTenant,model,pool};
}
describe("private root/child same-transaction admission composition",()=>{
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
