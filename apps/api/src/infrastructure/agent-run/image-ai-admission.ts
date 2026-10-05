/** Trusted composition for native image billing. Never accept a price or owner from tool args. */
import {createHash} from "node:crypto";
import type {ImageContext} from "../../application/agent-run/standard-image-tools";
import type {AiAdmissionPort} from "../../application/agent-run/ai-admission-ports";
import type {TokenUsageMeterPort} from "../../application/agent-run/ports";
import {priceNativeAiUsage,type AiNativePrice} from "../../domain/agent-run/ai-billable-unit";

export interface ImageDispatchRequest {
 readonly requestId:string;readonly modelProvider:string;readonly modelId:string;
 readonly serializedBody:string;readonly quantity:bigint;
}
export interface VerifiedImageAdmission {
 readonly orgId:ImageContext["orgId"];readonly userId:string;readonly runId:string;
 readonly sourceRunId:string;readonly subtaskId:string|null;readonly executionAttemptId:string;readonly executionLeaseEpoch:number;
 readonly projectId:string|null;readonly threadId:string|null;readonly agentId:string|null;
 readonly formalModelId:string;readonly logicalCallId:string;
 readonly windowStart:string;readonly windowEnd:string;
 readonly modelProvider:string;readonly modelId:string;readonly serializedBodySha256:string;
 readonly maximumQuantity:bigint;readonly price:AiNativePrice;
 /** A native-only tariff. Mixed Token/image tariffs require another verified adapter. */
 readonly tokenBilling:"not-applicable";readonly bindingVerified:true;
}
export interface ImageAiReceipt {
 terminal(input:{endedAt:string;outcome:"succeeded"|"failed";quantity:bigint|null}):Promise<void>;
}
export interface ImageAiAdmission {
 start(context:ImageContext,request:ImageDispatchRequest):Promise<ImageAiReceipt>;
}
export interface ImageAiAdmissionDependencies {
 readonly admission:AiAdmissionPort;readonly usage:TokenUsageMeterPort;
 /** Must authorize the current run/lease/member and resolve an immutable audited native tariff. */
 readonly resolve:(context:ImageContext,request:ImageDispatchRequest)=>Promise<VerifiedImageAdmission|null>;
}
export function prepareImageAiAdmission(deps:ImageAiAdmissionDependencies):ImageAiAdmission {
 return {start:async(context,request)=>{
  const resolved=await deps.resolve(context,request);
  const binding=resolved?{...resolved,price:{...resolved.price}}:null;
  if(!binding)throw new Error("AI_IMAGE_POLICY_UNCONFIGURED");
  if(!deps.usage.startRequest)throw new Error("AI_DURABLE_START_UNAVAILABLE");
  if(binding.orgId!==context.orgId||!binding.userId||!binding.formalModelId||!binding.logicalCallId||!binding.runId||binding.sourceRunId!==context.parentRunId
   ||(binding.subtaskId===null?binding.sourceRunId!==binding.runId:binding.subtaskId!==binding.sourceRunId||binding.runId===binding.sourceRunId)
   ||binding.executionAttemptId!==context.attemptId||binding.executionLeaseEpoch!==context.leaseEpoch
   ||binding.modelProvider!==request.modelProvider||binding.modelId!==request.modelId||binding.bindingVerified!==true
   ||binding.tokenBilling!=="not-applicable"||binding.price.unit!=="image"
   ||binding.serializedBodySha256!==createHash("sha256").update(request.serializedBody).digest("hex")
   ||request.quantity<=0n||binding.maximumQuantity<request.quantity||binding.maximumQuantity>9223372036854775807n)
   throw new Error("AI_IMAGE_BOUND_UNVERIFIED");
  const maximumCostMicros=priceNativeAiUsage(binding.price,{kind:"native",unit:"image",quantity:binding.maximumQuantity,source:"reported"});
  if(maximumCostMicros===null||maximumCostMicros<=0n)throw new Error("AI_IMAGE_PRICE_UNCONFIGURED");
  const reservation=await deps.admission.reserve(context.orgId,{requestId:request.requestId,userId:binding.userId,
   formalModelId:binding.formalModelId,agentId:binding.agentId,logicalCallId:binding.logicalCallId,logicalAttempt:0,maximumAttempts:1,
   windowStart:binding.windowStart,windowEnd:binding.windowEnd,maximumTokens:0n,maximumCostMicros,
   modelProvider:request.modelProvider,modelId:request.modelId,currency:binding.price.currency,priceVersion:binding.price.version,
   nativePolicy:{unit:"image",maximumQuantity:binding.maximumQuantity}});
  if(reservation.decision!=="allowed")throw new Error(reservation.decision);
  if(reservation.replay)throw new Error("AI_REQUEST_REPLAY_NO_DISPATCH");
  const startedAt=new Date().toISOString();
  await deps.usage.startRequest(context.orgId,{requestId:request.requestId,userId:binding.userId,runId:binding.runId,subtaskId:binding.subtaskId,
   executionAttemptId:binding.executionAttemptId,executionLeaseEpoch:binding.executionLeaseEpoch,projectId:binding.projectId,
   threadId:binding.threadId,agentId:binding.agentId,callPurpose:"native-image",modelProvider:request.modelProvider,modelId:request.modelId,startedAt});
  let terminalFingerprint:string|undefined;
  return {terminal:async input=>{
   if(!Number.isFinite(Date.parse(input.endedAt))||Date.parse(input.endedAt)<Date.parse(startedAt))throw new Error("AI_IMAGE_TERMINAL_TIME_INVALID");
   const quantity=input.quantity!==null&&input.quantity>=0n&&input.quantity<=9223372036854775807n?input.quantity:null;
   const fingerprint=JSON.stringify([input.endedAt,input.outcome,quantity?.toString()??null]);
   if(terminalFingerprint!==undefined&&terminalFingerprint!==fingerprint)throw new Error("AI_IMAGE_TERMINAL_REPLAY_MISMATCH");
   terminalFingerprint=fingerprint;
   const costMicros=priceNativeAiUsage(binding.price,{kind:"native",unit:"image",quantity,source:quantity===null?"unknown":"reported"});
   await deps.usage.record(context.orgId,{eventId:request.requestId,userId:binding.userId,runId:binding.runId,subtaskId:binding.subtaskId,
    executionAttemptId:binding.executionAttemptId,projectId:binding.projectId,threadId:binding.threadId,agentId:binding.agentId,
    callPurpose:"native-image",modelProvider:request.modelProvider,modelId:request.modelId,requestStartedAt:startedAt,requestEndedAt:input.endedAt,
    tokensTotal:0,totalSource:"not-applicable",promptTokens:null,completionTokens:null,
    nativeUsage:{unit:"image",quantity,source:quantity===null?"unknown":"reported"},
    ...(costMicros===null?{}:{costMicros,currency:binding.price.currency,priceVersion:binding.price.version}),outcome:input.outcome});
   await deps.admission.settle(context.orgId,request.requestId,{tokens:0n,costMicros});
   if(quantity!==null&&quantity>binding.maximumQuantity)throw new Error("AI_IMAGE_PROVIDER_BOUND_VIOLATED");
  }};
 }};
}
/** Only an explicit supplier count is known. Missing, fractional or invalid dimensions are unknown. */
export function readReportedImageQuantity(raw:unknown):bigint|null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const count=(raw as Record<string,unknown>).image_count;
 return typeof count==="number"&&Number.isSafeInteger(count)&&count>=0?BigInt(count):null;
}
