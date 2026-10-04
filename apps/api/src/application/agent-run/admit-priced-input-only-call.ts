import type {DatabasePort} from "../ports/database.port";
import {createHash} from 'node:crypto';
import type {OrgId} from '../../domain/org-id';
import {prepareInputOnlyAiAttempt,priceInputOnlyTokens,type AiInputOnlyPrice,type VerifiedInputOnlyBound,type VerifiedInputOnlyBinding} from '../../domain/agent-run/ai-input-only-attempt';
import type {AiPoolCandidate} from '../../domain/agent-run/ai-safe-attempt';
import type {AiAdmissionPort,AiBudgetPolicyPort} from './ai-admission-ports';
export interface InputOnlyPreparedRequest {readonly requestId:string;readonly modelProvider:string;readonly modelId:string;readonly serializedBody:string;readonly requestPath:string;}
export interface InputOnlyCallSubject {
 readonly orgId:OrgId;readonly userId:string;readonly logicalCallId:string;readonly primaryModelId:string;readonly attempt:number;
 readonly confidentiality:'confidential'|'non-confidential'|'unknown';readonly requiredCapabilities:readonly string[];
}
export interface InputOnlyAdmissionDependencies {
 readonly currentCandidates:()=>Promise<{pool:readonly AiPoolCandidate[];bindings:readonly VerifiedInputOnlyBinding[]}>;
 readonly measure:(request:InputOnlyPreparedRequest)=>Promise<VerifiedInputOnlyBound|null>;
}
/** Called within the owner's existing tenant transaction. No model is constructed or
 * retried here; only an explicitly verified input-only mode can reserve a budget. */
export async function admitPricedInputOnlyCall(subject:InputOnlyCallSubject,request:InputOnlyPreparedRequest,deps:InputOnlyAdmissionDependencies&{
 readonly policy:AiBudgetPolicyPort;readonly admission:AiAdmissionPort;
}){
 if(!subject.userId||!subject.logicalCallId)throw new Error('AI_TRUSTED_SUBJECT_MISSING');
 const budget=await deps.policy.resolveBudgetPolicy(subject.orgId,subject.userId);
 if(budget.decision!=='configured')throw new Error(budget.decision);
 const digest=createHash('sha256').update(request.serializedBody).digest('hex');
 const current=await deps.currentCandidates(),measuredInput=await deps.measure(request);
 const decision=prepareInputOnlyAiAttempt({configuration:budget.configuration,priceVersion:budget.priceVersion,primaryModelId:subject.primaryModelId,
  attempt:subject.attempt,confidentiality:subject.confidentiality,requiredCapabilities:subject.requiredCapabilities,...current,measuredInput,serializedBodySha256:digest});
 if(decision.decision!=='allowed')throw new Error(decision.decision);
 if(request.modelProvider!==decision.modelProvider||request.modelId!==decision.runtimeModelId)throw new Error('AI_DISPATCH_BINDING_MISMATCH');
 const reservation=await deps.admission.reserve(subject.orgId,{requestId:request.requestId,userId:subject.userId,
  windowStart:budget.configuration.window.start,windowEnd:budget.configuration.window.end,logicalCallId:subject.logicalCallId,
  logicalAttempt:subject.attempt,maximumAttempts:budget.configuration.maxAttempts,maximumTokens:decision.maximumTokens,
  maximumCostMicros:decision.maximumCostMicros,modelProvider:decision.modelProvider,modelId:decision.runtimeModelId,
  currency:budget.configuration.currency,priceVersion:budget.priceVersion});
 if(reservation.decision!=='allowed')throw new Error(reservation.decision);
 if(reservation.replay)throw new Error('AI_REQUEST_REPLAY_NO_DISPATCH');
 return decision;
}
/** Raw missing completion stays missing in the ledger. Verified input-only pricing
 * may settle without it; inconsistent totals, unexpected output or cache uncertainty
 * retain the hold and never invent a supplier-reported zero. */
export function inputOnlyReceiptCost(price:AiInputOnlyPrice,usage:{total?:number;prompt?:number;completion?:number;cacheInput?:number;reasoningOutput?:number}):bigint|null{
 const valid=(n:number|undefined)=>n===undefined||Number.isSafeInteger(n)&&n>=0;
 if(!Object.values(usage).every(valid)||usage.total===undefined||usage.prompt===undefined||usage.total!==usage.prompt
  ||usage.cacheInput!==undefined&&usage.cacheInput>usage.prompt||usage.completion!==undefined&&usage.completion!==0||usage.reasoningOutput!==undefined&&usage.reasoningOutput!==0)return null;
 return priceInputOnlyTokens(price,{input:BigInt(usage.prompt),...(usage.cacheInput===undefined?{}:{cachedInput:BigInt(usage.cacheInput)})});
}

export interface InputOnlyRuntimeAdmissionOptions {
 readonly provider:string;
 readonly primaryModelId:(modelId:string)=>Promise<string>;
 readonly dependencies:(orgId:OrgId,scopedDb?:DatabasePort)=>InputOnlyAdmissionDependencies;
}
