import {beforeEach,describe,expect,it,vi} from "vitest";
import type {DatabasePort,TenantSession} from "../../src/application/ports/database.port";
import type {OrgId} from "../../src/domain/org-id";
import {createNativeQuotaWiring,type NativeBoundRegistration} from "../../src/infrastructure/agent-run/native-quota-wiring";
const state=vi.hoisted(()=>({policy:vi.fn(),reserve:vi.fn(),settle:vi.fn(),start:vi.fn(),owner:vi.fn()}));
vi.mock("../../src/infrastructure/auth/pg-ai-admission-repository",()=>({PgAiAdmissionRepository:class {
 constructor(readonly db:DatabasePort){}
 resolveBudgetPolicy(...args:unknown[]){return state.policy(...args);}
 reserve(...args:unknown[]){return this.db.withTenant(args[0] as OrgId,async()=>state.reserve(...args));}
 settle(...args:unknown[]){return this.db.withTenant(args[0] as OrgId,async()=>state.settle(...args));}
}}));
vi.mock("../../src/infrastructure/auth/pg-token-usage-repository",()=>({PgTokenUsageRepository:class {
 constructor(readonly db:DatabasePort){}
 startRequest(...args:unknown[]){return this.db.withTenant(args[0] as OrgId,async()=>state.start(...args));}
}}));
vi.mock("../../src/infrastructure/auth/pg-runtime-model-usage-repository",()=>({resolveRuntimeModelOwner:(...args:unknown[])=>state.owner(...args)}));
const orgId="org-a" as OrgId;
const owner={user_id:"trusted-user",root_run_id:"root",subtask_id:null,project_id:"project",thread_id:"thread",agent_id:"agent"};
const context={orgId,parentRunId:"root",attemptId:"root:0",leaseEpoch:1,bindingId:"binding",toolCallId:"tool"};
const request={requestId:"physical",modelProvider:"vendor",modelId:"runtime-image",serializedBody:'{"prompt":"private input","n":1}',quantity:1n};
const policy={decision:"configured",plan:"enterprise",priceVersion:"immutable-version",configuration:{currency:"CNY",window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z"},nativePrices:[{modelId:"formal-image",modelProvider:"vendor",runtimeModelId:"runtime-image",unit:"image",quantum:"1",microsPerQuantum:"7",maxQuantity:"2"}]}};
function fixture(registrationChanges:Partial<NativeBoundRegistration>={}){
 const verify=vi.fn(async()=>true),authorize=vi.fn(async()=>true),record=vi.fn(async()=>{});
 const bounds:NativeBoundRegistration={modelProvider:"vendor",formalModelId:"formal-image",runtimeModelId:"runtime-image",unit:"image",maximumQuantity:2n,verifyDeploymentBinding:verify,authorizeDispatch:authorize,...registrationChanges};
 let active=false;const queries:string[]=[];
 const session:TenantSession={query:async(sql)=>{if(!active)throw new Error("EXPIRED_SESSION");queries.push(sql);return {rows:[]};}};
 const db:DatabasePort={withTenant:async(org,work)=>{expect(org).toBe(orgId);active=true;try{return await work(session);}finally{active=false;}},withoutTenant:async()=>{throw new Error("UNSCOPED_DENIED");},close:async()=>{}};
 const wiring=createNativeQuotaWiring(true,{nativeBounds:[bounds]},{db,usage:{record}})!;
 return {wiring,db,verify,authorize,record,queries,bounds};
}
beforeEach(()=>{
 vi.clearAllMocks();state.policy.mockResolvedValue(policy);state.reserve.mockResolvedValue({decision:"allowed",replay:false});state.settle.mockResolvedValue(undefined);state.start.mockResolvedValue(undefined);state.owner.mockResolvedValue(owner);
});
describe("native quota composition",()=>{
 it("leaves disabled/missing deployments absent",()=>{
  const f=fixture();expect(createNativeQuotaWiring(false,{nativeBounds:[f.bounds]},{db:f.db,usage:{record:f.record}})).toBeNull();
  expect(createNativeQuotaWiring(true,null,{db:f.db,usage:{record:f.record}})).toBeNull();
 });
 it("pins native price and trusted owner, commits start before returning, uses fresh terminal transactions",async()=>{
  const f=fixture(),receipt=await f.wiring.image.start(context,request);
  expect(f.queries[0]).toContain("hashtext($1)");expect(f.queries[1]).toContain("hashtextextended");
  expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({userId:"trusted-user",orgId,runId:"root"}),{kind:"image",request});
  expect(state.policy).toHaveBeenCalledWith(orgId,"trusted-user","not-applicable");
  expect(state.reserve).toHaveBeenCalledWith(orgId,expect.objectContaining({maximumTokens:0n,maximumCostMicros:14n,priceVersion:"immutable-version",nativePolicy:{unit:"image",maximumQuantity:2n}}));
  expect(state.start).toHaveBeenCalledTimes(1);
  await receipt.terminal({endedAt:new Date(Date.now()+1000).toISOString(),outcome:"succeeded",quantity:1n});
  expect(f.record).toHaveBeenCalledWith(orgId,expect.objectContaining({costMicros:7n,priceVersion:"immutable-version",totalSource:"not-applicable"}));
  expect(state.settle).toHaveBeenCalledWith(orgId,"physical",{tokens:0n,costMicros:7n});
 });
 it.each(["unverified","dispatch-denied","wrong-model","wrong-price-unit","missing-price","bound-too-low","owner-denied"])("fails closed with zero durable start for %s",async kind=>{
  const f=fixture(kind==="bound-too-low"?{maximumQuantity:1n}:{});
  if(kind==="unverified")f.verify.mockResolvedValue(false);
  if(kind==="dispatch-denied")f.authorize.mockResolvedValue(false);
  if(kind==="owner-denied")state.owner.mockResolvedValue(undefined);
  if(kind==="missing-price")state.policy.mockResolvedValue({...policy,configuration:{...policy.configuration,nativePrices:[]}});
  if(kind==="wrong-price-unit")state.policy.mockResolvedValue({...policy,configuration:{...policy.configuration,nativePrices:[{...policy.configuration.nativePrices[0],unit:"millisecond"}]}});
  await expect(f.wiring.image.start(context,kind==="wrong-model"?{...request,modelId:"other"}:request)).rejects.toThrow();
  expect(state.start).not.toHaveBeenCalled();expect(state.reserve).not.toHaveBeenCalled();expect(f.record).not.toHaveBeenCalled();
 });
 it("ASR pins finite duration but retains cost hold for estimated transport duration",async()=>{
  const f=fixture({unit:"millisecond",maximumQuantity:2000n});
  state.policy.mockResolvedValue({...policy,configuration:{...policy.configuration,nativePrices:[{...policy.configuration.nativePrices[0],unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"2000"}]}});
  const receipt=await f.wiring.asr.start({kind:"run",orgId,runId:"root",attemptId:"root:0",leaseEpoch:1},{requestId:"asr-physical",modelProvider:"vendor",modelId:"runtime-image",startedAt:new Date().toISOString(),audio:{encoding:"pcm16le",channels:1,sampleRate:16000}});
  expect(receipt.maximumDurationMs).toBe(2000n);
  expect(state.reserve).toHaveBeenCalledWith(orgId,expect.objectContaining({maximumTokens:0n,maximumCostMicros:14n,nativePolicy:{unit:"millisecond",maximumQuantity:2000n}}));
  await receipt.terminal({endedAt:new Date().toISOString(),outcome:"failed",queuedDurationMs:1500n});
  expect(f.record).toHaveBeenCalledWith(orgId,expect.objectContaining({totalSource:"not-applicable",nativeUsage:{unit:"millisecond",quantity:1500n,source:"estimated"}}));
  expect(state.settle).toHaveBeenCalledWith(orgId,"asr-physical",{tokens:0n,costMicros:null});
 });
 it("ASR cannot authorize a draft without existing organization membership repositories",async()=>{
  const f=fixture({unit:"millisecond"});
  await expect(f.wiring.asr.start({kind:"draft",orgId,userId:"forged-user"},{requestId:"asr-physical",modelProvider:"vendor",modelId:"runtime-image",startedAt:new Date().toISOString(),audio:{encoding:"pcm16le",channels:1,sampleRate:16000}})).rejects.toThrow("ASR_ACCOUNTING_OWNER_DENIED");
  expect(f.authorize).not.toHaveBeenCalled();expect(state.reserve).not.toHaveBeenCalled();expect(state.start).not.toHaveBeenCalled();
 });
 it("ASR rejects malformed private ownership before metadata SQL",async()=>{
  const f=fixture({unit:"millisecond"});
  await expect(f.wiring.asr.start({kind:"run",orgId,runId:"root",attemptId:"root:0",leaseEpoch:0},{requestId:"asr-physical",modelProvider:"vendor",modelId:"runtime-image",startedAt:new Date().toISOString(),audio:{encoding:"pcm16le",channels:1,sampleRate:16000}})).rejects.toThrow("ASR_ACCOUNTING_OWNER_DENIED");
  expect(state.owner).not.toHaveBeenCalled();expect(state.reserve).not.toHaveBeenCalled();
 });
 it("ASR rejects an unverified audio transport before reservation",async()=>{
  const f=fixture({unit:"millisecond"});
  await expect(f.wiring.asr.start({kind:"run",orgId,runId:"root",attemptId:"root:0",leaseEpoch:1},{requestId:"asr-physical",modelProvider:"vendor",modelId:"runtime-image",startedAt:new Date().toISOString(),audio:{encoding:"mp3",channels:1,sampleRate:16000}})).rejects.toThrow("ASR_NATIVE_AUDIO_BOUND_UNVERIFIED");
  expect(state.reserve).not.toHaveBeenCalled();expect(state.start).not.toHaveBeenCalled();
 });
 it("refuses duplicate deployment identity",()=>{
  const f=fixture();expect(()=>createNativeQuotaWiring(true,{nativeBounds:[f.bounds,f.bounds]},{db:f.db,usage:{record:f.record}})).toThrow("AI_NATIVE_DEPLOYMENT_REGISTRATION_INVALID");
 });
 it("rejects replay before another durable start",async()=>{
  const f=fixture();state.reserve.mockResolvedValue({decision:"allowed",replay:true});
  await expect(f.wiring.image.start(context,request)).rejects.toThrow("AI_REQUEST_REPLAY_NO_DISPATCH");expect(state.start).not.toHaveBeenCalled();
 });
});
