import {createHash} from "node:crypto";
import type {ModelCallInput,ModelCallPort} from "./ports";
import type {ModelPoolRepository} from "../model/ports";
import type {AiPoolCandidate,VerifiedAiBinding,VerifiedInputBound} from "../../domain/agent-run/ai-safe-attempt";

type PreparedRequest=Parameters<NonNullable<ModelCallInput["beforeProviderDispatch"]>>[0];
export interface ModelBoundRegistration {
 readonly binding:VerifiedAiBinding;
 /** Trusted exact SDK endpoint/account grouping; absent disables private model replacement. */
 readonly privateConnectionId?:string;
 /** Code/deployment verification artifact, never taken from organization policy or model arguments. */
 readonly billingUnit:"token"|"native"|"unknown";
 readonly implementation:string;readonly version:string;readonly artifactSha256:string;
 readonly source:VerifiedInputBound["source"];
 /** Revalidates exact deployed route/model identity; false means revoked or unverified. */
 readonly verifyDeploymentBinding:()=>Promise<boolean>;
 /** Must include every billed input field (messages/images/tools/schema). No length heuristic fallback. */
 readonly measureSerializedBody:(body:string)=>Promise<number|null>;
}
/** Only trusted startup code can register entries. No API mutates this registry, and no
 * known provider/model/tokenizer is guessed. Unregistered/non-Token paths remain rejected.
 */
export class VerifiedModelBoundRegistry {
 private readonly entries:ReadonlyMap<string,ModelBoundRegistration>;
 constructor(private readonly model:ModelCallPort,registrations:readonly ModelBoundRegistration[]){
  const entries=new Map<string,ModelBoundRegistration>();
  for(const entry of registrations){
   const b=entry.binding,key=JSON.stringify([b.modelProvider,b.runtimeModelId]);
   if(entries.has(key)||!b.modelId||!b.modelProvider||!b.runtimeModelId||!entry.implementation||!entry.version
    ||!/^\w[\w.-]*$/.test(entry.implementation)||!/^[a-f0-9]{64}$/.test(entry.artifactSha256)
    ||!["provider-count","verified-tokenizer","verified-upper-bound"].includes(entry.source)
    ||!Number.isSafeInteger(b.contextWindow)||b.contextWindow<=0||!Number.isSafeInteger(b.maxOutputTokens)||b.maxOutputTokens<=0)
    throw new Error("AI_MODEL_BOUND_REGISTRATION_INVALID");
   entries.set(key,Object.freeze({...entry,binding:Object.freeze({...b,capabilityTags:Object.freeze([...b.capabilityTags])})}));
  }
  this.entries=entries;
 }
 private async verified(entry:ModelBoundRegistration):Promise<boolean>{
  const b=entry.binding;
  return entry.billingUnit==="token"&&b.outputCapSupported&&b.billedOutputBoundVerified&&b.accountingComplete
   &&this.model.supportsDispatchAdmission?.(b.modelProvider)===true&&this.model.supportsRequestAccounting?.(b.modelProvider)===true
   &&await entry.verifyDeploymentBinding();
 }
 async samePrivateConnection(provider:string,original:string,target:string):Promise<boolean>{
  const first=this.entries.get(JSON.stringify([provider,original])),second=this.entries.get(JSON.stringify([provider,target]));
  return !!first&&!!second&&!!first.privateConnectionId&&first.privateConnectionId===second.privateConnectionId
    &&await this.verified(first)&&await this.verified(second);
 }
 async formalModelId(modelProvider:string,pinnedId:string):Promise<string>{
  const matches=[...this.entries.values()].filter(entry=>entry.binding.modelProvider===modelProvider&&(entry.binding.modelId===pinnedId||entry.binding.runtimeModelId===pinnedId));
  if(matches.length!==1||!await this.verified(matches[0]!))throw new Error("AI_PINNED_MODEL_BINDING_UNVERIFIED");
  return matches[0]!.binding.modelId;
 }
 async currentCandidates(pool:ModelPoolRepository,orgId:string):Promise<{pool:readonly AiPoolCandidate[];bindings:readonly VerifiedAiBinding[]}>{
  const stored=await pool.listForOrg(orgId),byId=new Map(stored.map(item=>[item.row.modelId,item.row]));
  const rows=stored.map(({row})=>({...row,members:row.members.map(member=>{
   const current=byId.get(member.modelId);return {modelId:member.modelId,role:member.role,kind:current?.kind??"closed-api" as const,status:current?.status??"依赖失败" as const,complianceAttrs:current?.complianceAttrs??[]};
  })}));
  const bindings:VerifiedAiBinding[]=[];
  for(const entry of this.entries.values())if(await this.verified(entry))bindings.push(entry.binding);
  return {pool:rows,bindings};
 }
 async measure(request:PreparedRequest):Promise<VerifiedInputBound|null>{
  const entry=this.entries.get(JSON.stringify([request.modelProvider,request.modelId]));
  if(!entry||!await this.verified(entry))return null;
  // Exact model identity is part of the serialized object, not an upstream approximation.
  let body:unknown;try{body=JSON.parse(request.serializedBody);}catch{return null;}
  if(!body||typeof body!=="object"||Array.isArray(body)||(body as {model?:unknown}).model!==request.modelId)return null;
  const tokens=await entry.measureSerializedBody(request.serializedBody);
  if(tokens===null||!Number.isSafeInteger(tokens)||tokens<0)return null;
  return {modelProvider:request.modelProvider,runtimeModelId:request.modelId,tokens,source:entry.source,
   implementation:entry.implementation,version:entry.version,serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex")};
 }
}
