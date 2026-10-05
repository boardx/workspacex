import type {z} from "zod";
import type {Configuration,InputOnlyModelPrice} from "@repo/contracts/ai-policy";
import {decideModelRoute,resolveContainsConfidential} from "../model/route-call";
import type {AiPoolCandidate,VerifiedInputBound} from "./ai-safe-attempt";

export interface VerifiedInputOnlyBinding {
 readonly billingMode:"input-only";readonly modelId:string;readonly modelProvider:string;readonly runtimeModelId:string;
 readonly contextWindow:number;readonly capabilityTags:readonly string[];
 readonly noBilledOutputVerified:boolean;readonly accountingComplete:boolean;
}
export interface VerifiedInputOnlyBound extends VerifiedInputBound {readonly billingMode:"input-only";readonly serializedBodySha256:string;}
export interface AiInputOnlyPrice {readonly version:string;readonly currency:string;readonly inputMicrosPerMillion:bigint;readonly cachedInputMicrosPerMillion:bigint;}
/** Integer micros, including cache as a subset. Missing cache at unequal rates stays unknown. */
export function priceInputOnlyTokens(price:AiInputOnlyPrice,usage:{input:bigint;cachedInput?:bigint}):bigint|null{
 if(!price.version||!/^[A-Z]{3}$/.test(price.currency)||price.inputMicrosPerMillion<0n||price.cachedInputMicrosPerMillion<0n
  ||usage.input<0n||(usage.cachedInput!==undefined&&(usage.cachedInput<0n||usage.cachedInput>usage.input)))throw new Error("INVALID_AI_INPUT_ONLY_PRICE_OR_USAGE");
 if(usage.cachedInput===undefined&&price.inputMicrosPerMillion!==price.cachedInputMicrosPerMillion)return null;
 const cached=usage.cachedInput??0n;
 return ((usage.input-cached)*price.inputMicrosPerMillion+cached*price.cachedInputMicrosPerMillion+999999n)/1000000n;
}
type Denied="AI_POLICY_UNCONFIGURED"|"AI_CONFIDENTIALITY_UNKNOWN"|"AI_ATTEMPTS_EXHAUSTED"|"AI_MODEL_UNAVAILABLE"
 |"AI_MODEL_CAPABILITY_UNVERIFIED"|"AI_INPUT_BOUND_UNVERIFIED"|"AI_INPUT_LIMIT_REACHED"|"AI_MAXIMUM_COST_UNREPRESENTABLE";
export interface AllowedInputOnlyAttempt {readonly decision:"allowed";readonly modelId:string;readonly modelProvider:string;readonly runtimeModelId:string;
 readonly price:AiInputOnlyPrice;readonly inputPolicy:z.infer<typeof InputOnlyModelPrice>;readonly maximumTokens:bigint;readonly maximumCostMicros:bigint;}
/** Independent input-only decision; does not dispatch or manufacture a chat output bound. */
export function prepareInputOnlyAiAttempt(input:{configuration:z.infer<typeof Configuration>|null;priceVersion:string|null;
 primaryModelId:string;attempt:number;confidentiality:"confidential"|"non-confidential"|"unknown";requiredCapabilities:readonly string[];
 pool:readonly AiPoolCandidate[];bindings:readonly VerifiedInputOnlyBinding[];measuredInput:VerifiedInputOnlyBound|null;
 serializedBodySha256:string}):AllowedInputOnlyAttempt|{decision:Denied}{
 const config=input.configuration;if(!config||!input.priceVersion)return {decision:"AI_POLICY_UNCONFIGURED"};
 if(!Number.isSafeInteger(input.attempt)||input.attempt<0||input.attempt>=config.maxAttempts)return {decision:"AI_ATTEMPTS_EXHAUSTED"};
 const id=[input.primaryModelId,...config.fallbackModelIds.filter(id=>id!==input.primaryModelId)][input.attempt];
 if(!id)return {decision:"AI_ATTEMPTS_EXHAUSTED"};
 const signal=input.confidentiality==="non-confidential"?false:input.confidentiality==="confidential"?true:"unknown";
 // I-12 treats unknown as confidential; I-21 forbids quota degradation in that lane.
 if(input.attempt>0&&resolveContainsConfidential(signal))return {decision:"AI_MODEL_UNAVAILABLE"};
 const route=decideModelRoute({pool:input.pool,requestedModelId:id,confidentiality:signal});
 const candidate=input.pool.find(row=>row.modelId===id&&route.ok&&route.selectedModelId===id);
 const policy=config.prices.find(row=>row.modelId===id);
 if(!candidate||candidate.shape!=="single"||!policy||!("billingMode" in policy)||policy.billingMode!=="input-only")return {decision:"AI_MODEL_UNAVAILABLE"};
 const binding=input.bindings.find(row=>row.modelId===id&&row.modelProvider===policy.modelProvider&&row.runtimeModelId===policy.runtimeModelId);
 if(!binding||binding.billingMode!=="input-only"||!binding.noBilledOutputVerified||!binding.accountingComplete
  ||!Number.isSafeInteger(binding.contextWindow)||binding.contextWindow<=0||!Number.isSafeInteger(candidate.contextWindow)||candidate.contextWindow<=0
  ||policy.maxInputTokens>Math.min(binding.contextWindow,candidate.contextWindow)
  ||input.requiredCapabilities.some(tag=>!binding.capabilityTags.includes(tag)||!candidate.capabilityTags.includes(tag)))return {decision:"AI_MODEL_CAPABILITY_UNVERIFIED"};
 const bound=input.measuredInput;
 if(!bound||bound.billingMode!=="input-only"||bound.modelProvider!==policy.modelProvider||bound.runtimeModelId!==policy.runtimeModelId
  ||!Number.isSafeInteger(bound.tokens)||bound.tokens<0||!bound.implementation||!bound.version
  ||!["provider-count","verified-tokenizer","verified-upper-bound"].includes(bound.source)
  ||!/^[a-f0-9]{64}$/.test(input.serializedBodySha256)||bound.serializedBodySha256!==input.serializedBodySha256)return {decision:"AI_INPUT_BOUND_UNVERIFIED"};
 if(bound.tokens>policy.maxInputTokens)return {decision:"AI_INPUT_LIMIT_REACHED"};
 const price:AiInputOnlyPrice={version:input.priceVersion,currency:config.currency,inputMicrosPerMillion:BigInt(policy.inputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(policy.cachedInputMicrosPerMillion)};
 const highest=price.inputMicrosPerMillion>price.cachedInputMicrosPerMillion?price.inputMicrosPerMillion:price.cachedInputMicrosPerMillion;
 const maximumTokens=BigInt(bound.tokens),maximumCostMicros=priceInputOnlyTokens({...price,inputMicrosPerMillion:highest,cachedInputMicrosPerMillion:highest},{input:maximumTokens})!;
 if(maximumCostMicros>9223372036854775807n)return {decision:"AI_MAXIMUM_COST_UNREPRESENTABLE"};
 return {decision:"allowed",modelId:id,modelProvider:policy.modelProvider,runtimeModelId:policy.runtimeModelId,price,inputPolicy:policy,maximumTokens,maximumCostMicros};
}
