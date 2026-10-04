import type {z} from "zod";
import {isUtcCalendarMonthWindow,type Configuration} from "@repo/contracts/ai-policy";
type Config=z.infer<typeof Configuration>;
/** Existing member quota is a natural UTC month. Never transplant it to another window. */
export function resolveMemberTokenLimit(config:Config,userId:string,monthlyLimit:string|null):string|null {
 const controls=config.tokenControls;
 if(!controls)return config.ordinaryTokensPerUser;
 if(controls.quotaSource==="organization-template")return controls.memberOverrides.find(row=>row.userId===userId)?.tokens??config.ordinaryTokensPerUser;
 if(!isUtcCalendarMonthWindow(config.window))throw new Error("AI_MEMBER_QUOTA_WINDOW_INCOMPATIBLE");
 return monthlyLimit;
}
/** Warning/degradation are configured signals, never permission to exceed the final hard stop. */
export function evaluateAiTokenThresholds(config:Config,plan:"ordinary"|"enterprise",usedAndHeld:bigint):{warning:boolean;degrade:boolean} {
 if(usedAndHeld<0n)throw new Error("INVALID_AI_TOKEN_USAGE");
 const controls=config.tokenControls;
 if(plan==="enterprise"||!controls)return {warning:false,degrade:false};
 return {warning:controls.warningAtTokens!==null&&usedAndHeld>=BigInt(controls.warningAtTokens),
  degrade:controls.degradeAtTokens!==null&&usedAndHeld>=BigInt(controls.degradeAtTokens)};
}
/** Each billed rate must not rise; at least one must fall. Caps do not prove a cheaper price. */
export function isStrictlyCheaperAiModel(config:Config,primaryId:string,candidateId:string):boolean {
 const primary=config.prices.find(row=>row.modelId===primaryId),candidate=config.prices.find(row=>row.modelId===candidateId);
 if(!primary||!candidate||primaryId===candidateId)return false;
 if(("billingMode" in primary)!==("billingMode" in candidate))return false;
 const primaryRates=[primary.inputMicrosPerMillion,primary.cachedInputMicrosPerMillion,...("outputMicrosPerMillion" in primary?[primary.outputMicrosPerMillion]:[])].map(BigInt);
 const candidateRates=[candidate.inputMicrosPerMillion,candidate.cachedInputMicrosPerMillion,...("outputMicrosPerMillion" in candidate?[candidate.outputMicrosPerMillion]:[])].map(BigInt);
 return candidateRates.every((rate,i)=>rate<=primaryRates[i]!)&&candidateRates.some((rate,i)=>rate<primaryRates[i]!);
}
