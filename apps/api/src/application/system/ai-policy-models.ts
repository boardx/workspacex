import type {z} from "zod";
import {Candidate,Configuration} from "@repo/contracts/ai-policy";
import type {ModelPoolRepository} from "../model/ports";
import {selectableModels} from "../../domain/model/selectable";
import type {ModelPurpose} from "../../domain/model/registry";
import {PlatformOrganizationError} from "./platform-organization-ports";

/** Reuse the single selectable/confidential rule; missing composite members fail closed. */
export async function aiPolicyCandidates(pool:ModelPoolRepository,orgId:string,providers:readonly string[],purpose:ModelPurpose|null=null):Promise<z.infer<typeof Candidate>[]> {
 const models=await pool.listForOrg(orgId),byId=new Map(models.map(model=>[model.row.modelId,model.row]));
 const candidates=selectableModels(models.map(({row})=>({...row,members:row.members.map(member=>{
  const found=byId.get(member.modelId);return {modelId:member.modelId,role:member.role,kind:found?.kind??"closed-api" as const,
   status:found?.status??"依赖失败" as const,complianceAttrs:found?.complianceAttrs??[]};
 })})),purpose);
 // Composite execution and native-unit providers need separate per-member caps/pricing.
 return candidates.filter(candidate=>candidate.shape==="single").map(candidate=>{
  const row=byId.get(candidate.modelId)!;
  return Candidate.parse({modelId:row.modelId,displayName:row.displayName,kind:row.kind,capabilityTags:row.capabilityTags,contextWindow:row.contextWindow,modelProviders:[...providers]});
 });
}

export async function validateAiPolicyModels(pool:ModelPoolRepository,orgId:string,input:z.infer<typeof Configuration>,providers:readonly string[]):Promise<void>{
 const candidates=await aiPolicyCandidates(pool,orgId,providers),byId=new Map(candidates.map(row=>[row.modelId,row]));
 for(const price of input.prices){
  const model=byId.get(price.modelId);
  if(!model||!providers.includes(price.modelProvider)||price.maxInputTokens+("maxOutputTokens" in price?price.maxOutputTokens:0)>model.contextWindow)throw new PlatformOrganizationError("AI_POLICY_MODEL_UNAVAILABLE");
 }
 for(const price of input.nativePrices??[]){
  if(!byId.has(price.modelId)||!providers.includes(price.modelProvider))throw new PlatformOrganizationError("AI_POLICY_MODEL_UNAVAILABLE");
 }
 // An approved config is still pending: runtime must recheck routing, purpose, tokenizer
 // and real output cap support before reserving or invoking a candidate.
}
