import {AiQuotaPolicyError} from "./ai-quota-policy-error";
import {isStrictlyCheaperAiModel} from "../../domain/agent-run/ai-member-token-policy";
import {ModelCallError,type ModelCallInput,type ModelCallCompletion,type ModelCallPort,type ModelDeltaMetadata,type ModelCallProgressEvent} from "./ports";
import {preparePricedModelCall,type AiPricedCallSubject,type AiPricedCallDependencies} from "./admit-priced-model-call";

export interface AiModelSelection {
 readonly logicalCallId:string;readonly logicalAttempt:number;readonly modelId:string;
 readonly modelProvider:string;readonly runtimeModelId:string;readonly fallbackUsed:boolean;
 readonly notice?:"token-warning"|"quota-degradation";
}
export interface AiPricedCompletion extends ModelCallCompletion {readonly aiSelection:AiModelSelection;}

/** One trusted logical call, including its authorized bounded fallback attempts.
 * Not registered in runtime DI until all executor/Python/native paths have authoritative ownership and bounds.
 * Retry is never inferred from detail/message/provider text; only two concrete HTTP classifications allow it.
 */
export async function executePricedModelCall(
 subject:Omit<AiPricedCallSubject,"attempt">,
 input:Omit<ModelCallInput,"modelProvider"|"modelId"|"outputTokenLimit"|"beforeProviderDispatch"|"onProviderRequest">,
 deps:AiPricedCallDependencies&{readonly model:ModelCallPort;readonly onModelSelection?:(selection:AiModelSelection)=>Promise<void>;readonly verifyDispatch?:()=>Promise<void>},
 onDelta?:(delta:string,metadata?:ModelDeltaMetadata)=>Promise<void>,
 onProgress?:(event:ModelCallProgressEvent)=>Promise<void>,
):Promise<AiPricedCompletion>{
 let quotaDegradation=false;let ruleDegradeTarget:string|undefined;
 const cancelled=()=>{if(input.signal?.aborted)throw new Error("AI_CALL_CANCELLED");};
 cancelled();
 const budget=await deps.policy.resolveBudgetPolicy(subject.orgId,subject.userId);
 if(budget.decision!=="configured")throw new Error(budget.decision);
 for(let attempt=0;attempt<budget.configuration.maxAttempts;attempt++){
  cancelled();
  const candidate=[subject.primaryModelId,...budget.configuration.fallbackModelIds.filter(id=>id!==subject.primaryModelId)][attempt];
  if(ruleDegradeTarget&&candidate!==ruleDegradeTarget)continue;
  if(quotaDegradation&&(!candidate||!isStrictlyCheaperAiModel(budget.configuration,subject.primaryModelId,candidate)))continue;
  const prepared=await preparePricedModelCall({...subject,attempt},{...deps,onTokenWarning:async()=>{
   if(deps.onTokenWarning)await deps.onTokenWarning();
   else if(deps.onModelSelection)await deps.onModelSelection({...selection,notice:"token-warning"});
   else throw new Error("AI_WARNING_DELIVERY_UNAVAILABLE");
  }});
  const ids=[subject.primaryModelId,...budget.configuration.fallbackModelIds.filter(id=>id!==subject.primaryModelId)];
  const selection:AiModelSelection={logicalCallId:subject.logicalCallId,logicalAttempt:attempt,modelId:ids[attempt]!,
   modelProvider:prepared.modelProvider,runtimeModelId:prepared.modelId,fallbackUsed:attempt>0,...(quotaDegradation?{notice:"quota-degradation" as const}:{})};
  // User-facing integration can disclose the authorized model change before any new paid dispatch.
  await deps.onModelSelection?.(selection);
  let accountingFailed=false,emitted=false,dispatched=false;
  const bound:ModelCallInput={...input,...prepared,
   beforeProviderDispatch:async request=>{cancelled();await deps.verifyDispatch?.();await prepared.beforeProviderDispatch!(request);cancelled();await deps.verifyDispatch?.();},
   onProviderRequest:async event=>{if(event.phase==="started")dispatched=true;try{await prepared.onProviderRequest!(event);if(event.phase==="started"){cancelled();await deps.verifyDispatch?.();}}catch(error){accountingFailed=true;throw error;}},
  };
  try{
   if(onProgress){
    if(!deps.model.completeWithProgress)throw new Error("AI_PROGRESS_ADAPTER_UNAVAILABLE");
    const completion=await deps.model.completeWithProgress(bound,async event=>{emitted=true;await onProgress(event);},
     onDelta?async(delta,metadata)=>{emitted=true;await onDelta(delta,metadata);}:undefined);
    return {...completion,aiSelection:selection};
   }
   if(onDelta&&deps.model.completeStream){
    const completion=await deps.model.completeStream(bound,async(delta,metadata)=>{emitted=true;await onDelta(delta,metadata);});
    return {...completion,aiSelection:selection};
   }
   return {...await deps.model.complete(bound),aiSelection:selection};
  }catch(error){
   // Only an atomic pre-dispatch threshold decision permits quota degradation.
   if(error instanceof AiQuotaPolicyError&&error.decision==="AI_TOKEN_DEGRADE_REQUIRED"
    &&subject.confidentiality==="non-confidential"&&!input.signal?.aborted&&!emitted&&!accountingFailed&&!dispatched){quotaDegradation=true;ruleDegradeTarget=error.degradeToModelId;continue;}
   // Retrying after any emitted output would mix answers and can hide a paid partial call.
   if(input.signal?.aborted||emitted||accountingFailed||!(error instanceof ModelCallError)
    ||!error.retryDisposition||attempt+1>=budget.configuration.maxAttempts)throw error;
  }
 }
 throw new Error("AI_ATTEMPTS_EXHAUSTED");
}
