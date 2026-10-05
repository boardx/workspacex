import type {AsrAccountingContext,AsrRequestAccounting} from '../../application/recording/asr-request-accounting';
import type {AsrAudioFormat} from '../../application/recording/asr-ports';
import type {AiAdmissionPort} from '../../application/agent-run/ai-admission-ports';
import type {TokenUsageMeterPort} from '../../application/agent-run/ports';
import type {OrgId} from '../../domain/org-id';
import {priceNativeAiUsage,type AiNativePrice} from '../../domain/agent-run/ai-billable-unit';

export interface VerifiedAsrAdmission {
 readonly orgId:OrgId;readonly userId:string;readonly runId:string|null;
 /** Source may be a child; usage runId remains the authoritative root. */
 readonly sourceRunId:string|null;readonly subtaskId:string|null;
 readonly modelProvider:string;readonly runtimeModelId:string;
 readonly executionAttemptId:string|null;readonly executionLeaseEpoch?:number;
 readonly projectId:string|null;readonly threadId:string|null;readonly agentId:string|null;
 readonly formalModelId:string;readonly logicalCallId:string;readonly windowStart:string;readonly windowEnd:string;
 readonly price:AiNativePrice;readonly maximumQuantity:bigint;
 readonly bindingVerified:true;readonly tokenBilling:'not-applicable';
}
export interface AsrNativeAdmissionDependencies {
 readonly admission:AiAdmissionPort;readonly usage:TokenUsageMeterPort;
 /** Resolve trusted ownership, audited policy/version and exact deployed model binding. */
 readonly resolve:(context:AsrAccountingContext,request:AsrNativeAdmissionRequest)=>Promise<VerifiedAsrAdmission|null>;
}
/** Composition root owns an atomic owner + reserve + start transaction. */
export interface AsrNativeAdmissionPort {
 start(context:AsrAccountingContext,request:AsrNativeAdmissionRequest):ReturnType<typeof prepareAsrAiAdmission>;
}
export interface AsrNativeAdmissionRequest {
 readonly requestId:string;readonly modelProvider:string;readonly modelId:string;readonly startedAt:string;
 readonly audio:AsrAudioFormat;
}
/** PCM ceiling governs transport; transport duration is never an authoritative supplier bill. */
export async function prepareAsrAiAdmission(context:AsrAccountingContext,request:AsrNativeAdmissionRequest,deps:AsrNativeAdmissionDependencies):Promise<{
 readonly maximumDurationMs:bigint;readonly terminal:Awaited<ReturnType<AsrRequestAccounting['start']>>['terminal'];
}> {
 if(request.audio.encoding!=='pcm16le'||request.audio.channels!==1||!Number.isSafeInteger(request.audio.sampleRate)||request.audio.sampleRate<=0)
  throw new Error('ASR_NATIVE_AUDIO_BOUND_UNVERIFIED');
 const verified=await deps.resolve(context,request);
 if(!verified||verified.bindingVerified!==true||verified.tokenBilling!=='not-applicable'||verified.orgId!==context.orgId||!verified.userId
  ||verified.modelProvider!==request.modelProvider||verified.runtimeModelId!==request.modelId
  ||!verified.formalModelId||!verified.logicalCallId||verified.price.unit!=='millisecond'||verified.maximumQuantity<=0n
  ||verified.maximumQuantity>9223372036854775807n)throw new Error('ASR_NATIVE_BINDING_UNVERIFIED');
 if(context.kind==='run'&&((!verified.runId||verified.sourceRunId!==context.runId)||verified.executionAttemptId!==context.attemptId||verified.executionLeaseEpoch!==context.leaseEpoch))
  throw new Error('ASR_NATIVE_OWNER_DENIED');
 if(context.kind!=='run'&&(verified.userId!==(context.kind==='personal-capture'?context.ownerUserId:context.userId)||verified.runId!==null||verified.sourceRunId!==null||verified.subtaskId!==null||verified.executionAttemptId!==null))
  throw new Error('ASR_NATIVE_OWNER_DENIED');
 const maximumCost=priceNativeAiUsage(verified.price,{kind:'native',unit:'millisecond',quantity:verified.maximumQuantity,source:'reported'});
 if(maximumCost===null)throw new Error('ASR_NATIVE_PRICE_UNVERIFIED');
 const start=deps.usage.startRequest?.bind(deps.usage);
 if(!start)throw new Error('ASR_NATIVE_DURABLE_START_REQUIRED');
 const reservation=await deps.admission.reserve(context.orgId,{requestId:request.requestId,userId:verified.userId,formalModelId:verified.formalModelId,
  agentId:verified.agentId,logicalCallId:verified.logicalCallId,logicalAttempt:0,maximumAttempts:1,
  windowStart:verified.windowStart,windowEnd:verified.windowEnd,nativePolicy:{unit:'millisecond',maximumQuantity:verified.maximumQuantity},maximumTokens:0n,maximumCostMicros:maximumCost,
  modelProvider:request.modelProvider,modelId:request.modelId,currency:verified.price.currency,priceVersion:verified.price.version});
 if(reservation.decision!=='allowed')throw new Error(reservation.decision);
 if(reservation.replay)throw new Error('AI_REQUEST_REPLAY_NO_DISPATCH');
 // Native calls never manufacture a Token warning or consume product Token allocations.
 if(reservation.tokenWarning)throw new Error('ASR_NATIVE_TOKEN_POLICY_MISMATCH');
 await start(context.orgId,{requestId:request.requestId,userId:verified.userId,runId:verified.runId,
  subtaskId:verified.subtaskId,executionAttemptId:verified.executionAttemptId,executionLeaseEpoch:verified.executionLeaseEpoch,
  projectId:verified.projectId,threadId:verified.threadId,agentId:verified.agentId,modelProvider:request.modelProvider,modelId:request.modelId,
  startedAt:request.startedAt,callPurpose:'native-asr'});
 let terminal:Promise<void>|undefined,fingerprint:string|undefined;
 return {maximumDurationMs:verified.maximumQuantity,terminal:receipt=>{
  const currentFingerprint=JSON.stringify([receipt.endedAt,receipt.outcome,receipt.queuedDurationMs?.toString()??null]);
  if(fingerprint!==undefined&&fingerprint!==currentFingerprint)return Promise.reject(new Error('ASR_NATIVE_TERMINAL_REPLAY_MISMATCH'));
  fingerprint=currentFingerprint;
  if(!terminal)terminal=(async()=>{
   await deps.usage.record(context.orgId,{eventId:request.requestId,userId:verified.userId,runId:verified.runId,
    subtaskId:verified.subtaskId,executionAttemptId:verified.executionAttemptId??undefined,projectId:verified.projectId,threadId:verified.threadId,agentId:verified.agentId,
    modelProvider:request.modelProvider,modelId:request.modelId,requestStartedAt:request.startedAt,requestEndedAt:receipt.endedAt,
    callPurpose:'native-asr',outcome:receipt.outcome,totalSource:'not-applicable',tokensTotal:0,promptTokens:null,completionTokens:null,
    nativeUsage:{unit:'millisecond',quantity:receipt.queuedDurationMs,source:receipt.queuedDurationMs===null?'unknown':'estimated'}});
   // Unknown supplier duration/rounding remains a conservative cost hold, including cancel/failure.
   await deps.admission.settle(context.orgId,request.requestId,{tokens:0n,costMicros:null});
  })().catch(error=>{terminal=undefined;throw error;});
  return terminal;
 }};
}
