import { randomUUID } from "node:crypto";
import { operations, SaveInput, isStageRequestTooLarge, readIdeaHmwSource, type SaveStageInput, type SharedStageValue } from "@repo/contracts/aidt-stages";
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
  getRevision(actor:StageActor,stageId:number,revision:number) {
    if(!operations.get.in.safeParse({projectId:actor.projectId,stageId}).success || !Number.isSafeInteger(revision) || revision<1 || revision>2147483647) throw new AidtStageError("AIDT_STAGE_INVALID");
    return this.access(actor,false,async(tx,d)=>{
      if(!tx.revision) throw new AidtStageError("AIDT_STAGE_UNAVAILABLE");
      const stage=unwrap(await tx.revision(stageId,revision),d);
      if(stage && (stage.projectId!==actor.projectId || stage.stageId!==stageId || stage.revision!==revision)) throw new AidtStageError("AIDT_STAGE_NOT_FOUND");
      return {stage};
    });
  }
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
      const rawHmw = input.stageId === 4 ? input.content.draft.fields.ideaHmwSource : undefined;
      if (rawHmw) {
        const hmw = readIdeaHmwSource(rawHmw);
        if (!hmw || !input.sourceStageRevisions.some(source => source.stageId === 3 && source.revision === hmw.revision)) throw new AidtStageError("AIDT_STAGE_INVALID");
        if (!tx.revision) throw new AidtStageError("AIDT_STAGE_UNAVAILABLE");
        const source = unwrap(await tx.revision(3, hmw.revision), d);
        if (!source || source.projectId !== actor.projectId || source.stageId !== 3 || source.revision !== hmw.revision ||
          source.content.draft.fields.definitionHmwId !== hmw.id || source.content.draft.fields.hmw?.trim() !== hmw.text) {
          throw new AidtStageError("AIDT_STAGE_INVALID");
        }
      }

      for(const idea of input.content.draft.ideas) if(idea.imageAttachment && !await tx.hasImageAttachment(idea.imageAttachment)) throw new AidtStageError("AIDT_STAGE_INVALID");
      for(const card of input.content.draft.discoveryCards??[]) if(card.photoAttachment && !await tx.hasImageAttachment(card.photoAttachment)) throw new AidtStageError("AIDT_STAGE_INVALID");
      const report = input.content.summaryReport;
      for (const source of report?.sourceStageRevisions ?? []) {
        if (!await tx.hasRevision(source.stageId, source.revision)) throw new AidtStageError("AIDT_STAGE_INVALID");
      }
      if (report?.confirmedAtRevision !== undefined) {
        const previousReport = input.reportEntityId
          ? current?.content.reports?.[input.reportEntityId]
          : current?.content.summaryReport;
        const carriedForward = stageRequestKey(report) === stageRequestKey(previousReport);
        const explicitlyConfirmed = Boolean(
          previousReport
          && report.markdown.trim()
          && previousReport.confirmedAtRevision === undefined
          && report.confirmedAtRevision === input.expectedRevision + 1
          && report.markdown === previousReport.markdown
          && stageRequestKey(report.sourceStageRevisions) === stageRequestKey(previousReport.sourceStageRevisions)
          && stageRequestKey(input.content.draft) === stageRequestKey(current?.content.draft)
          && stageRequestKey(input.sourceStageRevisions) === stageRequestKey(current?.sourceStageRevisions),
        );
        if (!carriedForward && !explicitlyConfirmed) throw new AidtStageError("AIDT_STAGE_INVALID");
      }
      const previousReports = current?.content.reports;
      if (input.reportEntityId && (
        stageRequestKey(input.content.draft) !== stageRequestKey(current?.content.draft ?? { fields: {}, ideas: [], selectedIdeaId: "" })
        || stageRequestKey(input.sourceStageRevisions) !== stageRequestKey(current?.sourceStageRevisions ?? [])
      )) throw new AidtStageError("AIDT_STAGE_INVALID");
      const content = input.reportEntityId && report ? {
        schemaVersion: input.content.schemaVersion,
        draft: input.content.draft,
        ...(current?.content.summaryReport ? { summaryReport: current.content.summaryReport } : {}),
        reports: { ...previousReports, [input.reportEntityId]: report },
      } : {
        ...input.content,
        ...(previousReports ? { reports: previousReports } : {}),
      };
      const stage: SharedStageValue = unwrap(await tx.append({ ...input, content }, key), d);
      return { stage, replayed: false };
    });
  }
}
export const AIDT_STAGES_SERVICE = Symbol("AidtStagesService");
