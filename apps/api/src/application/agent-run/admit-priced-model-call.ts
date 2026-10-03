import type {OrgId} from "../../domain/org-id";
import {prepareAiAttempt,type AiPoolCandidate,type VerifiedAiBinding,type VerifiedInputBound} from "../../domain/agent-run/ai-safe-attempt";
import {priceAiTokens} from "../../domain/agent-run/ai-budget";
import type {AiAdmissionPort,AiBudgetPolicyPort} from "./ai-admission-ports";
import type {ModelCallInput,ModelCallPort,TokenUsageMeterPort,TokenUsageRecord} from "./ports";

/** Trusted caller owns these identities; never construct this from client/model arguments. */
export interface AiPricedCallSubject {
 readonly orgId:OrgId;readonly userId:string;readonly runId:string;readonly executionAttemptId:string;
 readonly projectId:string|null;readonly threadId:string|null;readonly agentId:string|null;
 readonly callPurpose:NonNullable<TokenUsageRecord["callPurpose"]>;
 readonly primaryModelId:string;readonly logicalCallId:string;readonly attempt:number;
 readonly confidentiality:"confidential"|"non-confidential"|"unknown";readonly requiredCapabilities:readonly string[];
}
/** Source composition for an adapter that exposes exactly one real HTTP attempt. Not activated in DI. */
export async function preparePricedModelCall(subject:AiPricedCallSubject,deps:{
 readonly model:Pick<ModelCallPort,"supportsDispatchAdmission"|"supportsRequestAccounting">;
 readonly policy:AiBudgetPolicyPort;readonly admission:AiAdmissionPort;readonly usage:TokenUsageMeterPort;
 readonly currentCandidates:()=>Promise<{pool:readonly AiPoolCandidate[];bindings:readonly VerifiedAiBinding[]}>;
 /** Must bound this exact serialized body with a verified provider/tokenizer, including images/tools. */
 readonly measure:(request:Parameters<NonNullable<ModelCallInput["beforeProviderDispatch"]>>[0])=>Promise<VerifiedInputBound|null>;
}):Promise<Pick<ModelCallInput,"modelProvider"|"modelId"|"outputTokenLimit"|"beforeProviderDispatch"|"onProviderRequest">>{
 if(!subject.userId||!subject.runId||!subject.executionAttemptId||!subject.logicalCallId)throw new Error("AI_TRUSTED_SUBJECT_MISSING");
 const startRequest=deps.usage.startRequest?.bind(deps.usage);
 if(!startRequest)throw new Error("AI_DURABLE_START_UNAVAILABLE");
 const budget=await deps.policy.resolveBudgetPolicy(subject.orgId,subject.userId);
 if(budget.decision!=="configured")throw new Error(budget.decision);
 const configuration=budget.configuration;
 const ids=[subject.primaryModelId,...configuration.fallbackModelIds.filter(id=>id!==subject.primaryModelId)];
 if(!Number.isSafeInteger(subject.attempt)||subject.attempt<0||subject.attempt>=configuration.maxAttempts)throw new Error("AI_ATTEMPTS_EXHAUSTED");
 const price=configuration.prices.find(p=>p.modelId===ids[subject.attempt]);
 if(!price)throw new Error("AI_MODEL_UNAVAILABLE");
 if(!deps.model.supportsDispatchAdmission?.(price.modelProvider)||!deps.model.supportsRequestAccounting?.(price.modelProvider))throw new Error("AI_DISPATCH_BOUNDARY_UNAVAILABLE");
 const prepared=new Map<string,{decision:Extract<ReturnType<typeof prepareAiAttempt>,{decision:"allowed"}>;startedAt?:string}>();
 return {modelProvider:price.modelProvider,modelId:price.runtimeModelId,outputTokenLimit:price.maxOutputTokens,
  beforeProviderDispatch:async request=>{
   if(request.modelProvider!==price.modelProvider||request.modelId!==price.runtimeModelId
    ||request.outputTokenLimit===undefined||request.outputTokenLimit>price.maxOutputTokens)throw new Error("AI_DISPATCH_BINDING_MISMATCH");
   if(prepared.has(request.requestId))throw new Error("AI_REQUEST_REPLAY_NO_DISPATCH");
   const current=await deps.currentCandidates();
   const decision=prepareAiAttempt({configuration,priceVersion:budget.priceVersion,primaryModelId:subject.primaryModelId,
    attempt:subject.attempt,confidentiality:subject.confidentiality,requiredCapabilities:subject.requiredCapabilities,
    ...current,measuredInput:await deps.measure(request)});
   if(decision.decision!=="allowed")throw new Error(decision.decision);
   const reservation=await deps.admission.reserve(subject.orgId,{requestId:request.requestId,userId:subject.userId,
    windowStart:configuration.window.start,windowEnd:configuration.window.end,logicalCallId:subject.logicalCallId,logicalAttempt:subject.attempt,maximumAttempts:configuration.maxAttempts,maximumTokens:decision.maximumTokens,
    maximumCostMicros:decision.maximumCostMicros,modelProvider:price.modelProvider,modelId:price.runtimeModelId,
    currency:configuration.currency,priceVersion:budget.priceVersion});
   if(reservation.decision!=="allowed")throw new Error(reservation.decision);
   if(reservation.replay)throw new Error("AI_REQUEST_REPLAY_NO_DISPATCH");
   prepared.set(request.requestId,{decision});
  },
  onProviderRequest:async event=>{
   const state=prepared.get(event.requestId);if(!state)throw new Error("AI_REQUEST_NOT_ADMITTED");
   if(event.phase==="started"){
    if(state.startedAt&&state.startedAt!==event.startedAt)throw new Error("AI_START_REPLAY_MISMATCH");
    await startRequest(subject.orgId,{requestId:event.requestId,userId:subject.userId,runId:subject.runId,
     executionAttemptId:subject.executionAttemptId,projectId:subject.projectId,threadId:subject.threadId,agentId:subject.agentId,
     callPurpose:subject.callPurpose,modelProvider:price.modelProvider,modelId:price.runtimeModelId,startedAt:event.startedAt});
    state.startedAt=event.startedAt;return;
   }
   if(!state.startedAt||state.startedAt!==event.startedAt)throw new Error("AI_TERMINAL_WITHOUT_START");
   const valid=(n:number|undefined):number|null=>n!==undefined&&Number.isSafeInteger(n)&&n>=0?n:null;
   const usage=event.usage??{},total=valid(usage.total),prompt=valid(usage.prompt),completion=valid(usage.completion);
   const cache=valid(usage.cacheInput),reasoning=valid(usage.reasoningOutput);
   const cached=cache!==null&&prompt!==null&&cache<=prompt?cache:null;
   const reasoned=reasoning!==null&&completion!==null&&reasoning<=completion?reasoning:null;
   // Missing/inconsistent billable dimensions never release the conservative hold.
   const cost=total!==null&&prompt!==null&&completion!==null&&BigInt(prompt)+BigInt(completion)===BigInt(total)
    &&(cache===null?state.decision.price.cachedInputMicrosPerMillion===state.decision.price.inputMicrosPerMillion:cached!==null)&&(reasoning===null||reasoned!==null)
    ?priceAiTokens(state.decision.price,{input:BigInt(prompt),output:BigInt(completion),...(cached===null?{}:{cachedInput:BigInt(cached)})}):null;
   await deps.usage.record(subject.orgId,{eventId:event.requestId,userId:subject.userId,runId:subject.runId,
    executionAttemptId:subject.executionAttemptId,projectId:subject.projectId,threadId:subject.threadId,agentId:subject.agentId,
    callPurpose:subject.callPurpose,modelProvider:price.modelProvider,modelId:price.runtimeModelId,
    requestStartedAt:state.startedAt,requestEndedAt:event.endedAt,totalSource:total===null?"unknown":"reported",
    tokensTotal:total??0,promptTokens:prompt,completionTokens:completion,cacheInputTokens:cached,reasoningOutputTokens:reasoned,
    ...(cost===null?{}:{costMicros:cost,currency:configuration.currency,priceVersion:budget.priceVersion}),outcome:event.outcome??"failed"});
   await deps.admission.settle(subject.orgId,event.requestId,{tokens:total===null?null:BigInt(total),costMicros:cost});
  }};
}
