import {createHash} from "node:crypto";
import type {ModelPoolRepository} from "../model/ports";
import type {AiPoolCandidate} from "../../domain/agent-run/ai-safe-attempt";
import type {VerifiedInputOnlyBinding,VerifiedInputOnlyBound} from "../../domain/agent-run/ai-input-only-attempt";
export interface InputOnlyPreparedRequest {readonly modelProvider:string;readonly modelId:string;readonly requestPath:string;readonly serializedBody:string;}
export interface InputOnlyModelBoundRegistration {
 readonly binding:VerifiedInputOnlyBinding;readonly requestPath:string;
 readonly implementation:string;readonly version:string;readonly artifactSha256:string;
 readonly source:VerifiedInputOnlyBound["source"];
 /** Trusted deployed transport proof: includes input-only billing and actual per-HTTP accounting/admission. */
 readonly verifyDeploymentBinding:()=>Promise<boolean>;
 /** Counts all billed fields across the whole batch, including token-array inputs. */
 readonly measureSerializedBody:(body:string)=>Promise<number|null>;
}
/** No chat adapter capability claims, provider guesses or caller-editable registrations. */
export class VerifiedInputOnlyBoundRegistry {
 private readonly entries:ReadonlyMap<string,InputOnlyModelBoundRegistration>;
 constructor(registrations:readonly InputOnlyModelBoundRegistration[]){
  const entries=new Map<string,InputOnlyModelBoundRegistration>();
  for(const entry of registrations){
   const b=entry.binding,key=JSON.stringify([b.modelProvider,b.runtimeModelId]);
   if(entries.has(key)||b.billingMode!=="input-only"||!b.modelId||!b.modelProvider||!b.runtimeModelId
    ||!Number.isSafeInteger(b.contextWindow)||b.contextWindow<=0||!entry.version
    ||!/^\w[\w.-]*$/.test(entry.implementation)||!/^[a-f0-9]{64}$/.test(entry.artifactSha256)
    ||!["provider-count","verified-tokenizer","verified-upper-bound"].includes(entry.source)
    ||!entry.requestPath.startsWith("/")||entry.requestPath.startsWith("//")||/[?#\s]/.test(entry.requestPath))throw new Error("AI_INPUT_ONLY_REGISTRATION_INVALID");
   entries.set(key,Object.freeze({...entry,binding:Object.freeze({...b,capabilityTags:Object.freeze([...b.capabilityTags])})}));
  }
  this.entries=entries;
 }
 private async verified(entry:InputOnlyModelBoundRegistration){
  return entry.binding.noBilledOutputVerified===true&&entry.binding.accountingComplete===true&&await entry.verifyDeploymentBinding()===true;
 }
 async formalModelId(provider:string,pinned:string):Promise<string>{
  const matches=[...this.entries.values()].filter(e=>e.binding.modelProvider===provider&&(e.binding.modelId===pinned||e.binding.runtimeModelId===pinned));
  if(matches.length!==1||!await this.verified(matches[0]!))throw new Error("AI_INPUT_ONLY_BINDING_UNVERIFIED");
  return matches[0]!.binding.modelId;
 }
 async currentCandidates(pool:ModelPoolRepository,orgId:string):Promise<{pool:readonly AiPoolCandidate[];bindings:readonly VerifiedInputOnlyBinding[]}>{
  const stored=await pool.listForOrg(orgId),byId=new Map(stored.map(({row})=>[row.modelId,row]));
  const rows=stored.map(({row})=>({...row,members:row.members.map(member=>{const current=byId.get(member.modelId);return {
   modelId:member.modelId,role:member.role,kind:current?.kind??"closed-api" as const,status:current?.status??"依赖失败" as const,complianceAttrs:current?.complianceAttrs??[]};})}));
  const bindings:VerifiedInputOnlyBinding[]=[];for(const entry of this.entries.values())if(await this.verified(entry))bindings.push(entry.binding);
  return {pool:rows,bindings};
 }
 async measure(request:InputOnlyPreparedRequest):Promise<VerifiedInputOnlyBound|null>{
  const entry=this.entries.get(JSON.stringify([request.modelProvider,request.modelId]));
  if(!entry||request.requestPath!==entry.requestPath||!await this.verified(entry))return null;
  let parsed:unknown;try{parsed=JSON.parse(request.serializedBody);}catch{return null;}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
  const body=parsed as Record<string,unknown>;
  if(body.model!==request.modelId||["max_tokens","max_completion_tokens","messages","tools"].some(key=>key in body))return null;
  const value=body.input;
  const tokens=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.every(n=>Number.isSafeInteger(n)&&Number(n)>=0);
  if(!(typeof value==="string"&&value.length>0)&&!(Array.isArray(value)&&value.length>0
   &&(value.every(v=>typeof v==="string"&&v.length>0)||tokens(value)||value.every(tokens))))return null;
  const count=await entry.measureSerializedBody(request.serializedBody);
  if(count===null||!Number.isSafeInteger(count)||count<0)return null;
  return {billingMode:"input-only",modelProvider:request.modelProvider,runtimeModelId:request.modelId,tokens:count,
   source:entry.source,implementation:entry.implementation,version:entry.version,serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex")};
 }
}
