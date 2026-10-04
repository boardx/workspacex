import {AiQuotaPolicyError} from "../../src/application/agent-run/ai-quota-policy-error";
import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {executePricedModelCall} from "../../src/application/agent-run/execute-priced-model-call";
import {ModelCallError,type ModelCallInput,type ModelCallPort} from "../../src/application/agent-run/ports";
import {toOrgId} from "../../src/domain/org-id";
const fixture=()=>{
 const prices=["primary","fallback"].map(id=>({modelId:id,modelProvider:"route",runtimeModelId:`vendor-${id}`,inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"1000000",cachedInputMicrosPerMillion:"1000000",maxInputTokens:10,maxOutputTokens:10}));
 const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"100",currency:"CNY",prices,fallbackModelIds:["fallback"],maxAttempts:2};
 const policy={resolveBudgetPolicy:vi.fn().mockResolvedValue({decision:"configured",plan:"ordinary",configuration,priceVersion:"v1"})};
 const admission={reserve:vi.fn().mockResolvedValue({decision:"allowed",replay:false}),settle:vi.fn().mockResolvedValue(undefined)};
 const usage={startRequest:vi.fn().mockResolvedValue(undefined),record:vi.fn().mockResolvedValue(undefined)};
 const calls:string[]=[];let error:unknown=new ModelCallError("MODEL_CALL_FAILED","HTTP 429",{total:1,prompt:1,completion:0},"rate-limited");let sequence=0;
 const complete=async(input:ModelCallInput)=>{
  const requestId=`request-${sequence++}`,startedAt="2026-10-04T00:00:00Z";
  await input.beforeProviderDispatch!({requestId,modelProvider:input.modelProvider,modelId:input.modelId,serializedBody:JSON.stringify({model:input.modelId,messages:[input.system,input.user]}),outputTokenLimit:input.outputTokenLimit});
  await input.onProviderRequest!({requestId,startedAt,phase:"started"});calls.push(input.modelId);
  const failed=calls.length===1&&error!==undefined;
  await input.onProviderRequest!({requestId,startedAt,endedAt:"2026-10-04T00:00:01Z",phase:"terminal",outcome:failed?"failed":"succeeded",usage:{total:1,prompt:1,completion:0}}).catch(()=>{});
  if(failed)throw error;return {text:"ok",tokens:1,promptTokens:1,completionTokens:0};
 };
 const model:ModelCallPort={supportsRequestAccounting:()=>true,supportsDispatchAdmission:()=>true,complete};
 const currentCandidates=vi.fn().mockResolvedValue({pool:prices.map(p=>({modelId:p.modelId,kind:"closed-api",shape:"single",status:"已启用",complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]})),bindings:prices.map(p=>({...p,contextWindow:100,capabilityTags:[],outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}))});
 const measure=vi.fn(async(request:{modelProvider:string;modelId:string;serializedBody:string})=>({modelProvider:request.modelProvider,runtimeModelId:request.modelId,tokens:1,implementation:"fixture",version:"1",serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex"),source:"provider-count" as const}));
 const subject={orgId:toOrgId("org-coordinator"),userId:"u",runId:"r",executionAttemptId:"a",logicalCallId:"stable-logical-call",projectId:null,threadId:null,agentId:null,callPurpose:"primary" as const,primaryModelId:"primary",confidentiality:"non-confidential" as const,requiredCapabilities:[]};
 return {subject,deps:{model,policy,admission,usage,currentCandidates,measure},calls,setError:(value:unknown)=>{error=value;}};
};
describe("one bounded authorized logical model call",()=>{
 it("cannot downgrade a required capability or confidential task to an unauthorized fallback",async()=>{
  const capable=fixture();const current=await capable.deps.currentCandidates();current.pool[0].capabilityTags=["vision"];current.bindings[0].capabilityTags=["vision"];capable.deps.currentCandidates.mockResolvedValue(current);
  await expect(executePricedModelCall({...capable.subject,requiredCapabilities:["vision"]},{system:"s",user:"u"},capable.deps)).rejects.toThrow("AI_MODEL_CAPABILITY_UNVERIFIED");expect(capable.calls).toEqual(["vendor-primary"]);
  const privateTask=fixture();const privatePool=await privateTask.deps.currentCandidates();privatePool.pool[0].kind="self-hosted";privateTask.deps.currentCandidates.mockResolvedValue(privatePool);
  await expect(executePricedModelCall({...privateTask.subject,confidentiality:"confidential"},{system:"s",user:"u"},privateTask.deps)).rejects.toThrow("AI_MODEL_UNAVAILABLE");expect(privateTask.calls).toEqual(["vendor-primary"]);
 });
 it("discloses each authorized model selection before dispatch, and refusal blocks its paid call",async()=>{
  const base=fixture();const selections:string[]=[];
  const deps={...base.deps,onModelSelection:vi.fn(async(selection:{modelId:string})=>{expect(base.calls).toHaveLength(selections.length);selections.push(selection.modelId);})};
  await executePricedModelCall(base.subject,{system:"s",user:"u"},deps);expect(selections).toEqual(["primary","fallback"]);
  const refused=fixture();const deny=new Error("model change not accepted");
  await expect(executePricedModelCall(refused.subject,{system:"s",user:"u"},{...refused.deps,onModelSelection:async()=>{throw deny;}})).rejects.toBe(deny);expect(refused.calls).toEqual([]);
 });
 it("freshly measures each authorized candidate and uses stable logical ID with distinct slots",async()=>{
  const {subject,deps,calls}=fixture();expect(await executePricedModelCall(subject,{system:"s",user:"u"},deps)).toMatchObject({text:"ok",aiSelection:{modelId:"fallback",runtimeModelId:"vendor-fallback",fallbackUsed:true,logicalAttempt:1}});
  expect(calls).toEqual(["vendor-primary","vendor-fallback"]);expect(deps.currentCandidates).toHaveBeenCalledTimes(2);expect(deps.measure).toHaveBeenCalledTimes(2);
  expect(deps.admission.reserve.mock.calls).toEqual([[subject.orgId,expect.objectContaining({logicalCallId:subject.logicalCallId,logicalAttempt:0,maximumAttempts:2})],[subject.orgId,expect.objectContaining({logicalCallId:subject.logicalCallId,logicalAttempt:1,maximumAttempts:2})]]);
  expect(deps.usage.record).toHaveBeenCalledTimes(2);expect(deps.admission.settle).toHaveBeenCalledTimes(2);
 });
 it("does not retry safety, arbitrary transport, auth or detail-string failures",async()=>{
  for(const failure of [new Error("AI_QUOTA_DENIED"),new ModelCallError("MODEL_CALL_FAILED","HTTP 401"),new ModelCallError("MODEL_CALL_FAILED","HTTP 429 but not trusted classification")]){
   const {subject,deps,calls,setError}=fixture();setError(failure);await expect(executePricedModelCall(subject,{system:"s",user:"u"},deps)).rejects.toBe(failure);expect(calls).toHaveLength(1);
  }
 });
 it("terminal ledger failure stops fallback while preserving a successful paid response",async()=>{
  const failed=fixture();failed.deps.usage.record.mockRejectedValue(new Error("ledger unavailable"));
  await expect(executePricedModelCall(failed.subject,{system:"s",user:"u"},failed.deps)).rejects.toBeInstanceOf(ModelCallError);expect(failed.calls).toHaveLength(1);expect(failed.deps.admission.settle).not.toHaveBeenCalled();
  const success=fixture();success.setError(undefined);success.deps.usage.record.mockRejectedValue(new Error("ledger unavailable"));
  expect(await executePricedModelCall(success.subject,{system:"s",user:"u"},success.deps)).toMatchObject({text:"ok"});expect(success.calls).toHaveLength(1);
 });
 it("quota denial, unknown confidentiality and initial cancellation send zero requests",async()=>{
  const denied=fixture();denied.deps.admission.reserve.mockResolvedValue({decision:"TOKEN_LIMIT_REACHED",replay:false});
  await expect(executePricedModelCall(denied.subject,{system:"s",user:"u"},denied.deps)).rejects.toThrow("TOKEN_LIMIT_REACHED");expect(denied.calls).toEqual([]);
  const unknown=fixture();await expect(executePricedModelCall({...unknown.subject,confidentiality:"unknown"},{system:"s",user:"u"},unknown.deps)).rejects.toThrow("AI_MODEL_UNAVAILABLE");expect(unknown.calls).toEqual([]);
  const cancelled=fixture();const abort=new AbortController();abort.abort();await expect(executePricedModelCall(cancelled.subject,{system:"s",user:"u",signal:abort.signal},cancelled.deps)).rejects.toThrow("AI_CALL_CANCELLED");expect(cancelled.calls).toEqual([]);expect(cancelled.deps.policy.resolveBudgetPolicy).not.toHaveBeenCalled();
 });
 it("preserves progress events and never retries after observed progress",async()=>{
  const base=fixture();const progress=vi.fn(async()=>{});
  base.deps.model.completeWithProgress=async(input,onProgress)=>{
   await onProgress({kind:"fixture-progress"} as never);
   throw new ModelCallError("MODEL_CALL_FAILED","HTTP 503",undefined,"temporarily-unavailable");
  };
  await expect(executePricedModelCall(base.subject,{system:"s",user:"u"},base.deps,undefined,progress)).rejects.toBeInstanceOf(ModelCallError);
  expect(progress).toHaveBeenCalledOnce();expect(base.deps.policy.resolveBudgetPolicy).toHaveBeenCalledTimes(2);
  expect(base.deps.admission.reserve).not.toHaveBeenCalled();
 });
 it("does not fallback after streamed output or cancellation during a failed attempt",async()=>{
  const streaming=fixture();streaming.deps.model.completeStream=async(input,onDelta)=>{await onDelta("paid partial");throw new ModelCallError("MODEL_CALL_FAILED","HTTP 503",undefined,"temporarily-unavailable");};
  const delta=vi.fn(async()=>{});await expect(executePricedModelCall(streaming.subject,{system:"s",user:"u"},streaming.deps,delta)).rejects.toBeInstanceOf(ModelCallError);expect(delta).toHaveBeenCalledOnce();expect(streaming.deps.model.completeStream).toBeDefined();expect(streaming.deps.admission.reserve).not.toHaveBeenCalled();
  const cancelled=fixture();const abort=new AbortController();cancelled.deps.usage.record.mockImplementation(async()=>{abort.abort();});await expect(executePricedModelCall(cancelled.subject,{system:"s",user:"u",signal:abort.signal},cancelled.deps)).rejects.toBeInstanceOf(ModelCallError);expect(cancelled.calls).toHaveLength(1);
 });
});

async function quotaFixture(cheaper=true){
 const f=fixture();f.setError(undefined);
 const budget=await f.deps.policy.resolveBudgetPolicy();
 Object.assign(budget.configuration,{tokenControls:{quotaSource:"organization-template",warningAtTokens:"50",degradeAtTokens:"80",memberOverrides:[]}});
 if(cheaper){const fallback=budget.configuration.prices.find((price:{modelId:string})=>price.modelId==="fallback")!;fallback.inputMicrosPerMillion="500000";fallback.outputMicrosPerMillion="500000";fallback.cachedInputMicrosPerMillion="500000";}
 return f;
}
describe("atomic product Token threshold coordination",()=>{
 it("denies primary before vendor and dispatches exactly one approved cheaper model",async()=>{
  const f=await quotaFixture();
  f.deps.admission.reserve.mockResolvedValueOnce({decision:"AI_TOKEN_DEGRADE_REQUIRED",replay:false}).mockResolvedValueOnce({decision:"allowed",replay:false});
  const selections:string[]=[];
  const result=await executePricedModelCall(f.subject,{system:"s",user:"u"},{...f.deps,onModelSelection:async selected=>{selections.push(selected.modelId);}});
  expect(result.aiSelection).toMatchObject({modelId:"fallback",logicalAttempt:1,fallbackUsed:true});
  expect(f.calls).toEqual(["vendor-fallback"]);expect(selections).toEqual(["primary","fallback"]);
  expect(f.deps.usage.startRequest).toHaveBeenCalledOnce();expect(f.deps.usage.record).toHaveBeenCalledOnce();expect(f.deps.admission.settle).toHaveBeenCalledOnce();
  expect(f.deps.admission.reserve.mock.calls.map(([,request])=>request.tokenPolicy)).toEqual([
   {primaryModelId:"primary",selectedModelId:"primary",allowDegradation:true},
   {primaryModelId:"primary",selectedModelId:"fallback",allowDegradation:true},
  ]);
 });
 it("absolute Token/cost hard stops never request a cheaper paid fallback",async()=>{
  for(const decision of ["TOKEN_LIMIT_REACHED","COST_LIMIT_REACHED"]){
   const f=await quotaFixture();f.deps.admission.reserve.mockResolvedValue({decision,replay:false});
   await expect(executePricedModelCall(f.subject,{system:"s",user:"u"},f.deps)).rejects.toBeInstanceOf(AiQuotaPolicyError);
   expect(f.calls).toEqual([]);expect(f.deps.admission.reserve).toHaveBeenCalledOnce();expect(f.deps.usage.startRequest).not.toHaveBeenCalled();
  }
 });
 it("equal or more expensive approved fallback cannot satisfy a quota degradation",async()=>{
  for(const expensive of [false,true]){
   const f=await quotaFixture(false),budget=await f.deps.policy.resolveBudgetPolicy();
   if(expensive)budget.configuration.prices[1]!.outputMicrosPerMillion="2000000";
   f.deps.admission.reserve.mockResolvedValue({decision:"AI_TOKEN_DEGRADE_REQUIRED",replay:false});
   await expect(executePricedModelCall(f.subject,{system:"s",user:"u"},f.deps)).rejects.toThrow("AI_ATTEMPTS_EXHAUSTED");
   expect(f.calls).toEqual([]);expect(f.deps.admission.reserve).toHaveBeenCalledOnce();expect(f.deps.usage.record).not.toHaveBeenCalled();
  }
 });
 it("unknown and confidential inputs keep the local primary and never quota downgrade",async()=>{
  for(const confidentiality of ["unknown","confidential"] as const){
   const f=await quotaFixture(),current=await f.deps.currentCandidates();current.pool.forEach((row:{kind:string})=>{row.kind="self-hosted";});
   f.deps.admission.reserve.mockResolvedValue({decision:"AI_TOKEN_DEGRADE_REQUIRED",replay:false});
   await expect(executePricedModelCall({...f.subject,confidentiality},{system:"s",user:"u"},f.deps)).rejects.toBeInstanceOf(AiQuotaPolicyError);
   expect(f.calls).toEqual([]);expect(f.deps.admission.reserve).toHaveBeenCalledOnce();
   expect(f.deps.admission.reserve.mock.calls[0]?.[1].tokenPolicy).toEqual({primaryModelId:"primary",selectedModelId:"primary",allowDegradation:false});
  }
 });
 it("warning is disclosed after reservation and before vendor; warning failure does not downgrade",async()=>{
  const f=await quotaFixture();f.deps.admission.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:true} as never);
  const warning=vi.fn(async()=>{expect(f.calls).toEqual([]);expect(f.deps.admission.reserve).toHaveBeenCalledOnce();});
  await executePricedModelCall(f.subject,{system:"s",user:"u"},{...f.deps,onTokenWarning:warning});expect(warning).toHaveBeenCalledOnce();expect(f.calls).toEqual(["vendor-primary"]);
  const failed=await quotaFixture();failed.deps.admission.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:true} as never);
  const error=new Error("warning delivery failed");await expect(executePricedModelCall(failed.subject,{system:"s",user:"u"},{...failed.deps,onTokenWarning:async()=>{throw error;}})).rejects.toBe(error);
  expect(failed.calls).toEqual([]);expect(failed.deps.admission.reserve).toHaveBeenCalledOnce();
 });
 it("successful fallback preserves paid output if terminal ledger fails and never adds another attempt",async()=>{
  const f=await quotaFixture();f.deps.admission.reserve.mockResolvedValueOnce({decision:"AI_TOKEN_DEGRADE_REQUIRED",replay:false}).mockResolvedValueOnce({decision:"allowed",replay:false});
  f.deps.usage.record.mockRejectedValue(new Error("terminal ledger failed"));
  expect(await executePricedModelCall(f.subject,{system:"s",user:"u"},f.deps)).toMatchObject({text:"ok"});
  expect(f.calls).toEqual(["vendor-fallback"]);expect(f.deps.admission.reserve).toHaveBeenCalledTimes(2);expect(f.deps.admission.settle).not.toHaveBeenCalled();
 });
 it("typed threshold error after actual primary dispatch cannot authorize a quota fallback",async()=>{
  const f=await quotaFixture();f.setError(new AiQuotaPolicyError("AI_TOKEN_DEGRADE_REQUIRED"));
  await expect(executePricedModelCall(f.subject,{system:"s",user:"u"},f.deps)).rejects.toBeInstanceOf(AiQuotaPolicyError);
  expect(f.calls).toEqual(["vendor-primary"]);expect(f.deps.admission.reserve).toHaveBeenCalledOnce();
 });
});

it("selection channel publishes token warning before paid dispatch without duplicate hook delivery",async()=>{
 const f=await quotaFixture();f.deps.admission.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:true} as never);
 const notices:(string|undefined)[]=[];
 await executePricedModelCall(f.subject,{system:"s",user:"u"},{...f.deps,onModelSelection:async selection=>{
  notices.push(selection.notice);expect(f.calls).toEqual([]);expect(f.deps.usage.startRequest).not.toHaveBeenCalled();
  if(selection.notice==="token-warning")expect(f.deps.admission.reserve).toHaveBeenCalledOnce();
 }});
 expect(notices).toEqual([undefined,"token-warning"]);expect(f.calls).toEqual(["vendor-primary"]);
 const both=await quotaFixture();both.deps.admission.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:true} as never);
 const hook=vi.fn(async()=>{expect(both.calls).toEqual([]);}),selection=vi.fn(async()=>{});
 await executePricedModelCall(both.subject,{system:"s",user:"u"},{...both.deps,onTokenWarning:hook,onModelSelection:selection});
 expect(hook).toHaveBeenCalledOnce();expect(selection).toHaveBeenCalledOnce();
});
it("missing both warning channels sends zero paid requests and preserves the conservative hold",async()=>{
 const missing=await quotaFixture();missing.deps.admission.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:true} as never);
 await expect(executePricedModelCall(missing.subject,{system:"s",user:"u"},missing.deps)).rejects.toThrow("AI_WARNING_DELIVERY_UNAVAILABLE");
 expect(missing.calls).toEqual([]);expect(missing.deps.usage.startRequest).not.toHaveBeenCalled();expect(missing.deps.usage.record).not.toHaveBeenCalled();
 // Admission already reserved a conservative hold; this test does not claim orphan-hold repair.
 expect(missing.deps.admission.reserve).toHaveBeenCalledOnce();expect(missing.deps.admission.settle).not.toHaveBeenCalled();
});
