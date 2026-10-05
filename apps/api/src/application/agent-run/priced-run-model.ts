import {createHash} from "node:crypto";
import type {OrgId} from "../../domain/org-id";
import type {ClaimedAgentRun,ModelCallInput,ModelCallPort,ModelDeltaMetadata,ModelCallProgressEvent} from "./ports";
import {executePricedModelCall,type AiModelSelection} from "./execute-priced-model-call";
import type {AiPricedCallDependencies} from "./admit-priced-model-call";
import {assertCurrentRunLease,currentRunLease} from "./run-lease";

export interface AiRunPolicyFacts {
 readonly confidentiality:"confidential"|"non-confidential"|"unknown";
 readonly requiredCapabilities:readonly string[];
}
export interface RunAiAdmission {
 readonly primaryModelId:(orgId:OrgId,run:ClaimedAgentRun)=>Promise<string>;
 /** Authoritative persisted task classification; absence is unknown, never assumed public. */
 readonly facts:(orgId:OrgId,run:ClaimedAgentRun,input:ModelCallInput)=>Promise<AiRunPolicyFacts>;
 readonly dependencies:(orgId:OrgId,run:ClaimedAgentRun)=>Omit<AiPricedCallDependencies,"model">;
 readonly selection:(orgId:OrgId,run:ClaimedAgentRun,selection:AiModelSelection)=>Promise<void>;
}
/** Called by the actual executor once per trusted claimed run. All three model-call shapes
 * enter the same coordinator. No caller-supplied requester or legacy outer receipt survives.
 */
export function pricedRunModel(delegate:ModelCallPort,orgId:OrgId,run:ClaimedAgentRun,admission:RunAiAdmission):ModelCallPort{
 const invoke=async(input:ModelCallInput,onDelta?: (delta:string,metadata?:ModelDeltaMetadata)=>Promise<void>,onProgress?: (event:ModelCallProgressEvent)=>Promise<void>)=>{
  if(input.orgId!==String(orgId)||input.runId!==run.runId||input.modelProvider!==run.modelProvider||input.modelId!==run.modelId)throw new Error("AI_RUN_CONTEXT_MISMATCH");
  await assertCurrentRunLease();
  const lease=currentRunLease();
  if(!lease||lease.orgId!==orgId||lease.runId!==run.runId||!input.executionAttemptId)throw new Error("AI_RUN_LEASE_MISSING");
  const callPurpose=input.usageCallPurpose??"primary";
  if(!["primary","history-summary","script-retry"].includes(callPurpose))throw new Error("AI_CALL_PURPOSE_INVALID");
  const expectedAttempt=callPurpose==="primary"?`${run.runId}:${run.resumeStepSeqBase??1}`:`${run.runId}:lease:${lease.epoch}:${callPurpose}`;
  if(input.executionAttemptId!==expectedAttempt||input.executionLeaseEpoch!==lease.epoch)throw new Error("AI_RUN_ATTEMPT_MISMATCH");
  const facts=await admission.facts(orgId,run,input);
  // Primary intent is stable across worker takeovers; auxiliary source content is hashed,
  // never stored as identity. Repeated identical auxiliary intent conservatively denies replay.
  const suffix=callPurpose==="primary"?(run.permissionRequestId??"initial"):
   createHash("sha256").update(JSON.stringify([input.system,input.user,input.history??[],input.skills??[],input.scriptProtocol??null])).digest("hex");
  const subject={orgId,userId:run.requesterUserId,runId:run.runId,executionAttemptId:input.executionAttemptId,executionLeaseEpoch:lease.epoch,
   logicalCallId:JSON.stringify([run.runId,callPurpose,suffix]),projectId:run.projectId,threadId:run.threadId,agentId:run.agentId,
   callPurpose,primaryModelId:await admission.primaryModelId(orgId,run),...facts};
  return executePricedModelCall(subject,input,{...admission.dependencies(orgId,run),model:delegate,verifyDispatch:assertCurrentRunLease,
   onModelSelection:selection=>admission.selection(orgId,run,selection)},onDelta,onProgress);
 };
 return new Proxy(delegate,{get(target,key){
  // Prevent legacy envelope metering from fabricating usage for rejected/unsupported calls.
  if(key==="supportsRequestAccounting")return ()=>true;
  const value=Reflect.get(target,key,target);
  if(typeof value!=="function")return value;
  if(key==="complete")return (input:ModelCallInput)=>invoke(input);
  if(key==="completeStream")return (input:ModelCallInput,onDelta:(delta:string,metadata?:ModelDeltaMetadata)=>Promise<void>)=>invoke(input,onDelta);
  if(key==="completeWithProgress")return (input:ModelCallInput,onProgress:(event:ModelCallProgressEvent)=>Promise<void>,onDelta?: (delta:string,metadata?:ModelDeltaMetadata)=>Promise<void>)=>invoke(input,onDelta,onProgress);
  return value.bind(target);
 }});
}
