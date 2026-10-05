import {createHash} from "node:crypto";
import {Configuration} from "@repo/contracts/ai-policy";
import {Candidate} from "@repo/contracts/organization-core-model";
import type {DatabasePort} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import type {ModelCallPort} from "../../application/agent-run/ports";
import type {OrgCoreModelAvailability,OrgCoreModelBinding} from "../../application/model/org-core-model-ports";
import {OrgCoreModelError} from "../../application/model/org-core-model-ports";
import type {OrgCoreModelCandidateReader,OrgCoreModelCandidateRow} from "../../application/model/org-core-model-candidates";
import {VerifiedModelBoundRegistry} from "../../application/agent-run/verified-model-bound-registry";
import type {AiQuotaRuntimeConfiguration} from "../agent-run/ai-runtime-wiring";
import {PgIdentityRepository} from "../identity/pg-identity-repository";
import {PgModelPoolRepository} from "./pg-model-pool-repository";
import {coreModelScopedDb} from "./pg-org-core-model-repository";
import {priceAiTokens} from "../../domain/agent-run/ai-budget";

/** Read-only availability never resolves member budget windows, reserves, or dispatches a model. */
export class VerifiedOrgCoreModelAvailability implements OrgCoreModelAvailability,OrgCoreModelCandidateReader {
 constructor(private readonly db:DatabasePort,private readonly configuration:AiQuotaRuntimeConfiguration|null,private readonly model:ModelCallPort){}
 async list(orgId:OrgId,actorId:string):Promise<readonly OrgCoreModelCandidateRow[]>{
  return this.db.withTenant(orgId,async session=>{
   const scoped=coreModelScopedDb(session,orgId);
   if((await new PgIdentityRepository(scoped).findOrgMembership(actorId,orgId))?.orgRole!=="admin")throw new OrgCoreModelError("NOT_ORG_ADMIN");
   return (await this.snapshot(orgId,scoped)).rows;
  });
 }
 async resolve(orgId:OrgId,modelId:string,actorId:string,scopedDb?:DatabasePort):Promise<OrgCoreModelBinding|null>{
  // Chat owners can revalidate their saved selection; admin authorization stays in the write use case.
  const resolve=async(scoped:DatabasePort)=>{
   if(!await new PgIdentityRepository(scoped).findOrgMembership(actorId,orgId))return null;
   return (await this.snapshot(orgId,scoped)).bindings.get(modelId)??null;
  };
  return scopedDb?resolve(scopedDb):this.db.withTenant(orgId,session=>resolve(coreModelScopedDb(session,orgId)));
 }
 private async snapshot(orgId:OrgId,scoped:DatabasePort):Promise<{rows:OrgCoreModelCandidateRow[];bindings:Map<string,OrgCoreModelBinding>}>{
  const policy=await scoped.withTenant(orgId,async session=>{
   const organization=(await session.query<{kind:string}>("SELECT kind FROM organizations WHERE id=$1 FOR SHARE",[orgId])).rows[0];
   if(organization?.kind!=="organization")throw new OrgCoreModelError("ORGANIZATION_REQUIRED");
   return (await session.query<{configuration:unknown;price_version:string}>("SELECT configuration,price_version FROM organization_ai_policies WHERE org_id=$1",[orgId])).rows[0];
  });
  const pool=new PgModelPoolRepository(scoped),stored=await pool.listForOrg(orgId),bindings=new Map<string,OrgCoreModelBinding>();
  const parsed=Configuration.safeParse(policy?.configuration);
  const config=parsed.success&&policy?.price_version?parsed.data:null;
  const deployment=this.configuration;
  const registry=deployment?new VerifiedModelBoundRegistry(this.model,deployment.modelBounds):null;
  const rows:OrgCoreModelCandidateRow[]=[];
  for(const {row} of stored){
   const registrations=deployment?.modelBounds.filter(entry=>entry.binding.modelId===row.modelId&&entry.binding.modelProvider===deployment.privateRuntimeProvider)??[];
   const registration=registrations.length===1?registrations[0]:undefined;
   const price=config?.prices.find(entry=>entry.modelId===row.modelId);
   let reason:string|null=null;
   if(row.status!=="已启用")reason="MODEL_NOT_ENABLED";
   else if(row.shape!=="single")reason="CORE_MODEL_SINGLE_REQUIRED";
   else if(!deployment||!registration)reason="DEPLOYMENT_BINDING_UNVERIFIED";
   else if(!deployment.coreModelRequiredCapabilities?.length||deployment.coreModelRequiredCapabilities.some(tag=>!tag.trim()||!row.capabilityTags.includes(tag)||!registration.binding.capabilityTags.includes(tag)))reason="CORE_MODEL_CAPABILITY_UNVERIFIED";
   else if(!config||!price||!("maxOutputTokens" in price))reason="CHAT_PRICE_UNCONFIGURED";
   else if(!registration.privateConnectionId||price.modelProvider!==registration.binding.modelProvider||price.runtimeModelId!==registration.binding.runtimeModelId)reason="PRIVATE_CONNECTION_UNVERIFIED";
   else if(price.maxOutputTokens>registration.binding.maxOutputTokens||price.maxInputTokens+price.maxOutputTokens>Math.min(row.contextWindow,registration.binding.contextWindow))reason="MODEL_BOUND_UNVERIFIED";
   if(!reason&&registration){
    // Established registry verifies exact deployed route, durable accounting and output/tokenizer artifacts.
    try{if(!registry||await registry.formalModelId(registration.binding.modelProvider,registration.binding.runtimeModelId)!==row.modelId)reason="MODEL_BOUND_UNVERIFIED";}catch{reason="MODEL_BOUND_UNVERIFIED";}
   }
   if(!reason&&config&&price&&"maxOutputTokens" in price){
    try{const maximumCost=priceAiTokens({version:policy!.price_version,currency:config.currency,inputMicrosPerMillion:BigInt(price.inputMicrosPerMillion)>BigInt(price.cachedInputMicrosPerMillion)?BigInt(price.inputMicrosPerMillion):BigInt(price.cachedInputMicrosPerMillion),outputMicrosPerMillion:BigInt(price.outputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(price.cachedInputMicrosPerMillion)}, {input:BigInt(price.maxInputTokens),output:BigInt(price.maxOutputTokens)});if(maximumCost>9223372036854775807n)reason="MODEL_COST_BOUND_UNVERIFIED";}catch{reason="MODEL_COST_BOUND_UNVERIFIED";}
   }
   const revision=registration&&price&&config?createHash("sha256").update(JSON.stringify([policy!.price_version,config.currency,price,registration.version,registration.artifactSha256,registration.privateConnectionId])).digest("hex"):null;
   const candidate=Candidate.parse({modelId:row.modelId,displayName:row.displayName,modelProvider:registration?.binding.modelProvider??null,runtimeModelId:registration?.binding.runtimeModelId??null,configRevision:revision,available:reason===null,reason});
   rows.push(candidate);
   if(candidate.available&&registration&&revision)bindings.set(row.modelId,{modelId:row.modelId,modelProvider:registration.binding.modelProvider,runtimeModelId:registration.binding.runtimeModelId,configRevision:revision,privateConnectionId:registration.privateConnectionId!});
  }
  return {rows,bindings};
 }
}
