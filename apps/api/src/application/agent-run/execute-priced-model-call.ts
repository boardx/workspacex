import {ModelCallError,type ModelCallInput,type ModelCallCompletion,type ModelCallPort,type ModelDeltaMetadata} from "./ports";
import {preparePricedModelCall,type AiPricedCallSubject,type AiPricedCallDependencies} from "./admit-priced-model-call";

export interface AiModelSelection {
 readonly logicalCallId:string;readonly logicalAttempt:number;readonly modelId:string;
 readonly modelProvider:string;readonly runtimeModelId:string;readonly fallbackUsed:boolean;
}
export interface AiPricedCompletion extends ModelCallCompletion {readonly aiSelection:AiModelSelection;}

/** One trusted logical call, including its authorized bounded fallback attempts.
 * Not registered in runtime DI until all executor/Python/native paths have authoritative ownership and bounds.
 * Retry is never inferred from detail/message/provider text; only two concrete HTTP classifications allow it.
 */
export async function executePricedModelCall(
 subject:Omit<AiPricedCallSubject,"attempt">,
 input:Omit<ModelCallInput,"modelProvider"|"modelId"|"outputTokenLimit"|"beforeProviderDispatch"|"onProviderRequest">,
 deps:AiPricedCallDependencies&{readonly model:ModelCallPort;readonly onModelSelection?:(selection:AiModelSelection)=>Promise<void>},
 onDelta?:(delta:string,metadata?:ModelDeltaMetadata)=>Promise<void>,
):Promise<AiPricedCompletion>{
 const cancelled=()=>{if(input.signal?.aborted)throw new Error("AI_CALL_CANCELLED");};
 cancelled();
 const budget=await deps.policy.resolveBudgetPolicy(subject.orgId,subject.userId);
 if(budget.decision!=="configured")throw new Error(budget.decision);
 for(let attempt=0;attempt<budget.configuration.maxAttempts;attempt++){
  cancelled();
  const prepared=await preparePricedModelCall({...subject,attempt},deps);
  const ids=[subject.primaryModelId,...budget.configuration.fallbackModelIds.filter(id=>id!==subject.primaryModelId)];
  const selection:AiModelSelection={logicalCallId:subject.logicalCallId,logicalAttempt:attempt,modelId:ids[attempt]!,
   modelProvider:prepared.modelProvider,runtimeModelId:prepared.modelId,fallbackUsed:attempt>0};
  // User-facing integration can disclose the authorized model change before any new paid dispatch.
  await deps.onModelSelection?.(selection);
  let accountingFailed=false,emitted=false;
  const bound:ModelCallInput={...input,...prepared,
   beforeProviderDispatch:async request=>{cancelled();await prepared.beforeProviderDispatch!(request);cancelled();},
   onProviderRequest:async event=>{try{await prepared.onProviderRequest!(event);}catch(error){accountingFailed=true;throw error;}},
  };
  try{
   if(onDelta&&deps.model.completeStream){
    const completion=await deps.model.completeStream(bound,async(delta,metadata)=>{emitted=true;await onDelta(delta,metadata);});
    return {...completion,aiSelection:selection};
   }
   return {...await deps.model.complete(bound),aiSelection:selection};
  }catch(error){
   // Retrying after any emitted output would mix answers and can hide a paid partial call.
   if(input.signal?.aborted||emitted||accountingFailed||!(error instanceof ModelCallError)
    ||!error.retryDisposition||attempt+1>=budget.configuration.maxAttempts)throw error;
  }
 }
 throw new Error("AI_ATTEMPTS_EXHAUSTED");
}
