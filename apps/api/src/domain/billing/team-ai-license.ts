import {TeamPaidTerm} from "@repo/contracts/billing-team";
/** Licensing never replaces membership, model policy, or credit admission. */
export function resolveTeamAiLicense(currentGeneration:string,plan:{plan:string;billingGeneration:string|null}|null,paidTerms:unknown[],at:Date):"allowed"|"subscription_required"|"unavailable"{
 if(!currentGeneration||!Number.isFinite(at.getTime()))return "unavailable";
 if(plan?.billingGeneration&&plan.billingGeneration!==currentGeneration)return "unavailable";
 if(plan?.plan==="enterprise")return plan.billingGeneration===currentGeneration?"allowed":"unavailable";
 if(plan&&plan.plan!=="ordinary")return "unavailable";
 const terms=paidTerms.map(t=>TeamPaidTerm.safeParse(t));
 if(terms.some(t=>!t.success))return "unavailable";
 const current=terms.flatMap(t=>t.success?[t.data]:[]).filter(t=>Date.parse(t.paidPeriodStart)<=at.getTime()&&Date.parse(t.paidPeriodEnd)>at.getTime());
 if(current.length>1)return "unavailable";
 if(current.length===0)return "subscription_required";
 return plan?.billingGeneration===currentGeneration?"allowed":"unavailable";
}
