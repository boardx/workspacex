import { randomUUID } from "node:crypto";
import { operations, SaveInput, isStageRequestTooLarge, type SaveStageInput, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { authorize } from "../identity/authorize";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { AidtStageError } from "../../domain/aidt-stages/errors";
import type { AidtStageRepository, StageActor, StageTransaction } from "./ports";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
function unwrap<T>(value:Guarded<T>,decision:PermissionDecision):T { const out=discloseDecided(value,decision); if(!isDisclosed(out)) throw new AidtStageError("AIDT_STAGE_NOT_FOUND"); return out.payload; }
/** Stable key for normalized contract values; key order cannot break retry identity. */
export function stageRequestKey(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stageRequestKey).join(",")}]`;
  if(value!==null && typeof value==="object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stageRequestKey(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export class AidtStagesService {
  constructor(private readonly repo:AidtStageRepository,private readonly enabled:()=>boolean=()=>false) {}
  private async access<T>(actor:StageActor,write:boolean,fn:(tx:StageTransaction,d:PermissionDecision)=>Promise<T>):Promise<T> {
    if(!this.enabled()) throw new AidtStageError("AIDT_STAGE_NOT_FOUND");
    try { return await this.repo.inProject(actor,async tx=>{
      if(!tx.project?.aidt) throw new AidtStageError("AIDT_STAGE_NOT_FOUND");
      // Explicit membership: an organization administrator's observer fallback is not a group membership.
      const workshop=await tx.identity.findProjectMembership(actor.userId,actor.projectId,actor.orgId);
      const general=workshop===null?await tx.identity.findNonWorkshopStanding(actor.userId,actor.projectId,actor.orgId):null;
      if(workshop===null && general?.memberRole==null) throw new AidtStageError("AIDT_STAGE_NOT_FOUND");
      const auth={repo:tx.identity,ids:{next:()=>randomUUID()}};
      const read=await authorize(auth,{...actor,object:{kind:"project",id:actor.projectId},action:"read.published"});
      if(!read.allowed) throw new AidtStageError("AIDT_STAGE_NOT_FOUND");
      if(write) {
        const allowed=await authorize(auth,{...actor,object:{kind:"project",id:actor.projectId},action:"content.renameFile"});
        if(!allowed.allowed || tx.project.status!=="active" || tx.project.orgStatus!=="active") throw new AidtStageError("AIDT_STAGE_READONLY");
      }
      return fn(tx,read);
    }); } catch(e) { if(e instanceof AidtStageError) throw e; throw new AidtStageError("AIDT_STAGE_UNAVAILABLE"); }
  }
  get(actor:StageActor,stageId:number) { const input=operations.get.in.safeParse({projectId:actor.projectId,stageId}); if(!input.success) throw new AidtStageError("AIDT_STAGE_INVALID"); return this.access(actor,false,async(tx,d)=>({stage:unwrap(await tx.current(stageId),d)})); }
  list(actor:StageActor) { return this.access(actor,false,async(tx,d)=>({items:await Promise.all([1,2,3,4,5,6].map(async stageId=>{const v=unwrap(await tx.current(stageId),d);return {stageId,revision:v?.revision??0,updatedBy:v?.updatedBy??null,updatedAt:v?.updatedAt??null};}))})); }
  history(actor:StageActor,stageId:number,beforeRevision?:number,limit=20) {
    const parsed=operations.history.in.safeParse({projectId:actor.projectId,stageId,beforeRevision,limit}); if(!parsed.success) throw new AidtStageError("AIDT_STAGE_INVALID");
    return this.access(actor,false,async(tx,d)=>{const rows=unwrap(await tx.history(stageId,beforeRevision,limit+1),d); const items=rows.slice(0,limit);return {items,nextBeforeRevision:rows.length>limit?items.at(-1)!.revision:null};});
  }
  save(actor:StageActor,raw:SaveStageInput) {
    if(isStageRequestTooLarge(raw)) throw new AidtStageError("AIDT_STAGE_TOO_LARGE");
    const parsed=SaveInput.safeParse({...raw,projectId:actor.projectId}); if(!parsed.success) throw new AidtStageError("AIDT_STAGE_INVALID");
    const input=parsed.data; const key=stageRequestKey(input);
    return this.access(actor,true,async(tx,d)=>{
      const receipt=unwrap(await tx.receipt(input.operationId),d);
      if(receipt) {if(receipt.requestKey!==key) throw new AidtStageError("AIDT_STAGE_OPERATION_CONFLICT");return {stage:receipt.stage,replayed:true};}
      const current=unwrap(await tx.current(input.stageId),d);
      if((current?.revision??0)!==input.expectedRevision) throw new AidtStageError("AIDT_STAGE_REVISION_CONFLICT",current);
      for(const source of input.sourceStageRevisions) if(!await tx.hasRevision(source.stageId,source.revision)) throw new AidtStageError("AIDT_STAGE_INVALID");
      for(const idea of input.content.draft.ideas) if(idea.imageAttachment && !await tx.hasImageAttachment(idea.imageAttachment)) throw new AidtStageError("AIDT_STAGE_INVALID");
      for(const card of input.content.draft.discoveryCards??[]) if(card.photoAttachment && !await tx.hasImageAttachment(card.photoAttachment)) throw new AidtStageError("AIDT_STAGE_INVALID");
      for(const source of input.content.summaryReport?.sourceStageRevisions??[]) if(!await tx.hasRevision(source.stageId,source.revision)) throw new AidtStageError("AIDT_STAGE_INVALID");
      const stage:SharedStageValue=unwrap(await tx.append(input,key),d); return {stage,replayed:false};
    });
  }
}
export const AIDT_STAGES_SERVICE = Symbol("AidtStagesService");
