import type {z} from "zod";
import type {Configuration} from "@repo/contracts/ai-policy";
import type {SelectableCandidateRow} from "../model/selectable";
import {decideModelRoute,resolveContainsConfidential} from "../model/route-call";
import {priceAiTokens,type AiPrice} from "./ai-budget";

export interface VerifiedAiBinding {
 readonly modelId:string;readonly modelProvider:string;readonly runtimeModelId:string;
 readonly capabilityTags:readonly string[];readonly contextWindow:number;readonly maxOutputTokens:number;
 /** Verified by the concrete adapter, never inferred from a display name/provider label. */
 readonly outputCapSupported:boolean;readonly billedOutputBoundVerified:boolean;readonly accountingComplete:boolean;
}
export interface VerifiedInputBound {
 readonly modelProvider:string;readonly runtimeModelId:string;
 readonly tokens:number;readonly implementation:string;readonly version:string;
 readonly serializedBodySha256?:string;
 readonly source:"provider-count"|"verified-tokenizer"|"verified-upper-bound";
}
type Decision="allowed"|"AI_POLICY_UNCONFIGURED"|"AI_CONFIDENTIALITY_UNKNOWN"|"AI_ATTEMPTS_EXHAUSTED"
 |"AI_MODEL_UNAVAILABLE"|"AI_MODEL_CAPABILITY_UNVERIFIED"|"AI_INPUT_BOUND_UNVERIFIED"|"AI_INPUT_LIMIT_REACHED"|"AI_MAXIMUM_COST_UNREPRESENTABLE";
type Allowed={decision:"allowed";modelId:string;modelProvider:string;runtimeModelId:string;maxOutputTokens:number;
 maximumTokens:bigint;maximumCostMicros:bigint;price:AiPrice};
export interface AiPoolCandidate extends SelectableCandidateRow {readonly contextWindow:number;readonly capabilityTags:readonly string[];}

/** Bounded authorized selection only. It performs no dispatch, fallback or estimation itself. */
export function prepareAiAttempt(input:{configuration:z.infer<typeof Configuration>|null;priceVersion:string|null;
 primaryModelId:string;attempt:number;confidentiality:"confidential"|"non-confidential"|"unknown";
 requiredCapabilities:readonly string[];pool:readonly AiPoolCandidate[];bindings:readonly VerifiedAiBinding[];
 measuredInput:VerifiedInputBound|null}):Allowed|{decision:Exclude<Decision,"allowed">}{
 const config=input.configuration;
 if(!config||!input.priceVersion)return {decision:"AI_POLICY_UNCONFIGURED"};
 if(!Number.isSafeInteger(input.attempt)||input.attempt<0||input.attempt>=config.maxAttempts)return {decision:"AI_ATTEMPTS_EXHAUSTED"};
 const ordered=[input.primaryModelId,...config.fallbackModelIds.filter(id=>id!==input.primaryModelId)];
 const id=ordered[input.attempt];if(!id)return {decision:"AI_ATTEMPTS_EXHAUSTED"};
 const signal=input.confidentiality==="non-confidential"?false:input.confidentiality==="confidential"?true:"unknown";
 // I-12 treats unknown as confidential; I-21 forbids quota degradation in that lane.
 if(input.attempt>0&&resolveContainsConfidential(signal))return {decision:"AI_MODEL_UNAVAILABLE"};
 const route=decideModelRoute({pool:input.pool,requestedModelId:id,confidentiality:signal});
 const candidate=input.pool.find(row=>row.modelId===id&&route.ok&&route.selectedModelId===id),policy=config.prices.find(row=>row.modelId===id);
 if(!candidate||candidate.shape!=="single"||!policy||!("maxOutputTokens" in policy))return {decision:"AI_MODEL_UNAVAILABLE"};
 const binding=input.bindings.find(row=>row.modelId===id&&row.modelProvider===policy.modelProvider&&row.runtimeModelId===policy.runtimeModelId);
 if(!binding||!binding.accountingComplete||!binding.outputCapSupported||!binding.billedOutputBoundVerified
  ||!Number.isSafeInteger(binding.contextWindow)||!Number.isSafeInteger(binding.maxOutputTokens)
  ||!Number.isSafeInteger(candidate.contextWindow)||policy.maxOutputTokens>binding.maxOutputTokens
  ||policy.maxInputTokens+policy.maxOutputTokens>Math.min(binding.contextWindow,candidate.contextWindow)
  ||input.requiredCapabilities.some(tag=>!binding.capabilityTags.includes(tag)||!candidate.capabilityTags.includes(tag)))return {decision:"AI_MODEL_CAPABILITY_UNVERIFIED"};
 const bound=input.measuredInput;
 if(!bound||bound.modelProvider!==policy.modelProvider||bound.runtimeModelId!==policy.runtimeModelId
  ||!["provider-count","verified-tokenizer","verified-upper-bound"].includes(bound.source)
  ||!Number.isSafeInteger(bound.tokens)||bound.tokens<0||!bound.implementation||!bound.version)return {decision:"AI_INPUT_BOUND_UNVERIFIED"};
 if(bound.tokens>policy.maxInputTokens)return {decision:"AI_INPUT_LIMIT_REACHED"};
 const price:AiPrice={version:input.priceVersion,currency:config.currency,inputMicrosPerMillion:BigInt(policy.inputMicrosPerMillion),
  outputMicrosPerMillion:BigInt(policy.outputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(policy.cachedInputMicrosPerMillion)};
 // Cache can be more expensive than uncached input. Reserve the largest authorized rate.
 const maximumPrice={...price,inputMicrosPerMillion:price.inputMicrosPerMillion>price.cachedInputMicrosPerMillion!
  ?price.inputMicrosPerMillion:price.cachedInputMicrosPerMillion!};
 const maximumCostMicros=priceAiTokens(maximumPrice,{input:BigInt(bound.tokens),output:BigInt(policy.maxOutputTokens)});
 if(maximumCostMicros>9223372036854775807n)return {decision:"AI_MAXIMUM_COST_UNREPRESENTABLE"};
 return {decision:"allowed",modelId:id,modelProvider:policy.modelProvider,runtimeModelId:policy.runtimeModelId,
  maxOutputTokens:policy.maxOutputTokens,maximumTokens:BigInt(bound.tokens)+BigInt(policy.maxOutputTokens),
  maximumCostMicros,price};
}
