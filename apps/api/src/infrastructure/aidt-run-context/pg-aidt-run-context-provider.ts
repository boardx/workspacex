import { entityLineage, problemReference } from "../../application/aidt-run-context/entity-lineage";
import { recoverProblemFraming, projectSavedSkillOutput } from "./pg-skill-output";
import { checkedInterviewExcerpt } from "../../application/aidt-stages/interview-skill-draft";
import { AIDT_ENTITY_THREAD_PREFIX } from "@repo/contracts/aidt-stages";
import { aidtEntityThreadId, aidtSavedEntityContext, aidtSavedEntityTitle } from "../../application/aidt-stages/entity-thread";
import { randomUUID } from "node:crypto";
import { AidtContextSelector, AidtStoredContextSnapshot, AidtContextReceipt, AIDT_STAGE_IDENTITIES, AIDT_SUMMARY_STABLE_NAME, AIDT_CONTEXT_LIMITS, aidtContextSelectorJson, type AidtContextSnapshot } from "@repo/contracts/aidt-run-context";
import { readConfirmedAidtReturn } from "@repo/contracts/aidt-return-reflection";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import type { OrgId } from "../../domain/org-id";
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { SkillStarterPackSource } from "../../application/skill-import/ports";
import type { AidtMessageAcceptancePort, AidtRunContextExecutionPort, AidtRunContextReceiptPort, AidtContextActor, AidtContextFocusRun, AidtRunContextSnapshotStore } from "../../application/aidt-run-context/ports";
import { reduceAidtApplication } from "../../application/aidt-run-context/application-receipt";
import { AidtContextError } from "../../application/aidt-run-context/errors";
import { prepareAidtContext, contextHash, type LoadedAidtContextSource } from "../../application/aidt-run-context/prepare";
import { verifyAidtPinnedSkill } from "../../application/aidt-run-context/approved-packs";
import { AidtStagesService } from "../../application/aidt-stages/service";
import { AidtStageError } from "../../domain/aidt-stages/errors";
import { authorize } from "../../application/identity/authorize";
import { resolveVisibility } from "../../application/chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../../application/security/permission-filter";
import { PgIdentityRepository } from "../identity/pg-identity-repository";
import { PgChatRepository } from "../chat/pg-chat-repository";
import { PgAidtStageRepository } from "../aidt-stages/pg-aidt-stage-repository";
import { PgAgentRunRepository } from "../agent-run/pg-agent-run-repository";
import { validateStoredAidtContext } from "./pg-aidt-run-context-store";
type Stored=import("@repo/contracts/aidt-run-context").AidtStoredContextSnapshot;
const unavailable=():never=>{throw new AidtContextError("AIDT_CONTEXT_NOT_AVAILABLE");};
function bound(session:TenantSession,orgId:OrgId):DatabasePort{return {async withTenant<T>(requested:OrgId,fn:(s:TenantSession)=>Promise<T>){if(requested!==orgId)unavailable();return fn(session);},async withoutTenant<T>():Promise<T>{return unavailable();},async close(){}};}
/** AIDT-only adapter. Ordinary boot constructs it without IO; every source read stays in caller's tenant transaction. */
export class PgAidtRunContextProvider implements AidtMessageAcceptancePort,AidtRunContextExecutionPort,AidtRunContextReceiptPort {
 constructor(private readonly db:DatabasePort,private readonly packs:SkillStarterPackSource,private readonly store:AidtRunContextSnapshotStore,private readonly enabled:()=>boolean=()=>false,private readonly clock:()=>string=()=>new Date().toISOString()){}
 private async timed<T>(session:TenantSession,work:(s:TenantSession)=>Promise<T>):Promise<T>{
  if(!this.enabled())return unavailable();const deadline=Date.now()+AIDT_CONTEXT_LIMITS.prepareTimeoutMs;
  const old=await session.query<{timeout:string}>(`SELECT current_setting('statement_timeout') AS timeout`);
  const limited:TenantSession={async query<R>(sql:string,params?:readonly unknown[]){const remaining=deadline-Date.now();if(remaining<=0)throw new AidtContextError("AIDT_CONTEXT_UNAVAILABLE");await session.query(`SELECT set_config('statement_timeout',$1,true)`,[`${remaining}ms`]);const result=await session.query<R>(sql,params);if(Date.now()>deadline)throw new AidtContextError("AIDT_CONTEXT_UNAVAILABLE");return result;}};
  try{const result=await work(limited);if(Date.now()>deadline)throw new AidtContextError("AIDT_CONTEXT_UNAVAILABLE");await session.query(`SELECT set_config('statement_timeout',$1,true)`,[old.rows[0]?.timeout??"0"]);return result;}catch(error){if(error instanceof AidtContextError)throw error;if(error instanceof AidtStageError)throw new AidtContextError(error.reasonCode==="AIDT_STAGE_UNAVAILABLE"?"AIDT_CONTEXT_UNAVAILABLE":"AIDT_CONTEXT_NOT_AVAILABLE");throw new AidtContextError("AIDT_CONTEXT_UNAVAILABLE");}
 }
 private selector(raw:AidtContextSelector){const result=AidtContextSelector.safeParse(raw);if(!result.success)throw new AidtContextError("AIDT_CONTEXT_INVALID");const selector=AidtContextSelector.parse(JSON.parse(aidtContextSelectorJson(result.data)));const refs=[...selector.stageRevisions,...(selector.purpose==="summary"?selector.historyRevisions:[])];if(refs.some(r=>!Number.isSafeInteger(r.revision)||r.revision>2147483647)||selector.purpose==="stage"&&selector.returnRevision!==undefined&&(!Number.isSafeInteger(selector.returnRevision)||selector.returnRevision>2147483647))throw new AidtContextError("AIDT_CONTEXT_INVALID");return selector;}
 /** Project -> org/member -> thread. Reentrant Stage reads cannot reverse the acquisition order. */
 private async accessIn(session:TenantSession,actor:AidtContextActor,write:boolean):Promise<{decision:PermissionDecision;stages:AidtStagesService;db:DatabasePort}>{
  const p=await session.query<{kind:string;status:string;aidt:boolean}>(`SELECT p.kind,p.status,EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt FROM projects p WHERE p.org_id=$1 AND p.id=$2 FOR NO KEY UPDATE OF p`,[actor.orgId,actor.projectId]);
  const project=p.rows[0];if(!project||project.kind!=="general"||!project.aidt)return unavailable();
  const o=await session.query<{status:string}>(`SELECT status FROM organizations WHERE id=$1 FOR SHARE`,[actor.orgId]);
  const orgMember=await session.query(`SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[actor.orgId,actor.userId]);
  const member=await session.query(`SELECT user_id FROM general_project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE`,[actor.orgId,actor.projectId,actor.userId]);
  if(!o.rows[0]||!orgMember.rows[0]||!member.rows[0]||write&&(project.status!=="active"||o.rows[0].status!=="active"))return unavailable();
  const thread=await session.query(`SELECT id FROM chat_threads WHERE org_id=$1 AND id=$2 AND project_id=$3 FOR UPDATE`,[actor.orgId,actor.threadId,actor.projectId]);if(!thread.rows[0])return unavailable();
  const db=bound(session,actor.orgId),identity=new PgIdentityRepository(db),deps={repo:identity,chat:new PgChatRepository(db),ids:{next:()=>randomUUID()}};
  const visibility=await resolveVisibility(deps,actor);if(visibility.kind!=="allow"||visibility.thread.projectId!==actor.projectId)return unavailable();
  if(write&&(visibility.thread.archived||visibility.actor.projectRole===null||visibility.actor.projectRole==="observer"))return unavailable();
  if(write){const decision=await authorize(deps,{...actor,object:{kind:"project",id:actor.projectId},action:"content.renameFile"});if(!decision.allowed)return unavailable();}
  return {decision:visibility.base,stages:new AidtStagesService(new PgAidtStageRepository(db),this.enabled),db};
 }
 private disclose(guarded:Guarded<Stored>,actor:AidtContextActor,decision:PermissionDecision):Stored {
  if(guarded.ref.kind!=="project"||guarded.ref.id!==actor.projectId)return unavailable();
  const result=discloseDecided(guarded,decision);if(!isDisclosed(result))return unavailable();const stored=validateStoredAidtContext(result.payload);
  if(stored.orgId!==actor.orgId||stored.projectId!==actor.projectId||stored.threadId!==actor.threadId)return unavailable();return stored;
 }
 private async exact(stages:AidtStagesService,actor:AidtContextActor,stageId:number,revision:number):Promise<SharedStageValue>{const value=(await stages.getRevision(actor,stageId,revision)).stage;if(!value||value.projectId!==actor.projectId||value.stageId!==stageId||value.revision!==revision)return unavailable();return value;}
 private async checkExcerpt(stages: AidtStagesService, actor: AidtContextActor, selected: SharedStageValue, entityId: string) {
  const excerpt = checkedInterviewExcerpt(selected.content.draft.fields, entityId, actor.projectId);
  if (!excerpt) return;
  const current = (await stages.get(actor, 2)).stage;
  if (!current) return unavailable();
  if (current.revision === selected.revision) return;
  const latest = checkedInterviewExcerpt(current.content.draft.fields, entityId, actor.projectId);
  if (!latest || latest.text !== excerpt.text || latest.name !== excerpt.name || latest.locator !== excerpt.locator) return unavailable();
 }
 private async checkReturn(stages:AidtStagesService,actor:AidtContextActor,selector:AidtContextSelector){
  if(selector.purpose!=="stage"||selector.returnRevision===undefined)return null;
  const row=await this.exact(stages,actor,6,selector.returnRevision),reflection=readConfirmedAidtReturn(row.content.draft,selector.stageId);if(!reflection)return unavailable();
  if(reflection.snapshot.sourceStageRevision!==null)await this.exact(stages,actor,5,reflection.snapshot.sourceStageRevision);
  return {row,payload:{trust:"untrusted-student-material",evidenceStatus:"not-verified",reviewStatus:"editor-confirmed",targetStage:reflection.targetStage,questionSourceStageRevision:reflection.snapshot.sourceStageRevision,fields:reflection.fields}};
 }
 private async focusIn(session:TenantSession,actor:AidtContextActor,selector:AidtContextSelector,pins:readonly string[],db:DatabasePort){
  const rows=await session.query<{skill_id:string;version_id:string;stable_name:string|null}>(`SELECT m.skill_id,m.version_id,sk.stable_name FROM thread_skill_mounts m LEFT JOIN skill_versions v ON v.id=m.version_id AND (v.org_id=m.org_id OR v.org_id=$3) LEFT JOIN skills sk ON sk.id=m.skill_id AND sk.id=v.skill_id AND sk.org_id=v.org_id WHERE m.org_id=$1 AND m.thread_id=$2 AND m.removed_at IS NULL ORDER BY m.mounted_at,m.mount_id LIMIT 257 FOR SHARE OF m`,[actor.orgId,actor.threadId,PLATFORM_ORG_ID]);
  if(rows.rows.length>256||rows.rows.some(row=>row.stable_name===null))return unavailable();
  const known=new Set<string>([...AIDT_STAGE_IDENTITIES.map(s=>s.skill),AIDT_SUMMARY_STABLE_NAME]),actual=rows.rows.filter(row=>known.has(row.stable_name!));if(actual.length!==1)return unavailable();
  const expected=selector.purpose==="summary"?AIDT_SUMMARY_STABLE_NAME:AIDT_STAGE_IDENTITIES.find(s=>s.id===selector.stageId)!.skill,mount=actual[0]!;
  if(mount.stable_name!==expected||!pins.includes(mount.version_id))return unavailable();
  const read=await new PgAgentRunRepository(db).readPinnedSkills(actor.orgId,[mount.version_id]),skill=read[0];if(read.length!==1||!skill?.package||skill.versionId!==mount.version_id||skill.package.skillId!==mount.skill_id||skill.stableName!==expected)return unavailable();
  await verifyAidtPinnedSkill(skill,this.packs);
  return {skillId:mount.skill_id,skillVersionId:mount.version_id,skillStableName:expected,title:selector.purpose==="summary"?skill.name:AIDT_STAGE_IDENTITIES.find(s=>s.id===selector.stageId)!.title};
 }
 async prepareIn(session:TenantSession,actor:AidtContextActor,raw:AidtContextSelector,run:AidtContextFocusRun){
  const selector=this.selector(raw);if(selector.projectId!==actor.projectId)return unavailable();
  if (actor.threadId.startsWith(AIDT_ENTITY_THREAD_PREFIX)) {
    const stageId = selector.purpose === "stage" ? selector.stageId : 6;
    const purpose = selector.purpose === "stage" ? "stage" : "report";
    if (!selector.entityId || aidtEntityThreadId(actor, stageId, selector.entityId, purpose) !== actor.threadId) return unavailable();
    if (selector.purpose === "stage" && (selector.returnRevision !== undefined || selector.stageRevisions.some(
      ref => ref.stageId !== stageId && !(stageId === 2 && ref.stageId === 1 && selector.sourceEntityId)))) return unavailable();
  } else if (selector.entityId) return unavailable();

  return this.timed(session,async s=>{
   const scope=await this.accessIn(s,actor,true),focus=await this.focusIn(s,actor,selector,run.skillVersionIds,scope.db);
   const heads=new Map((await scope.stages.list(actor)).items.map(row=>[row.stageId,row.revision]));const loaded:LoadedAidtContextSource[]=[];
   const revisions = new Map<string, SharedStageValue>();
   const exact = async (step:number,revision:number) => {
     const key = step + ":" + revision;
     const cached = revisions.get(key);
     if (cached) return cached;
     const value = await this.exact(scope.stages,actor,step,revision);
     revisions.set(key,value);
     return value;
   };
   for (const ref of selector.stageRevisions) {
     const stage = await exact(ref.stageId, ref.revision);
     if (selector.purpose === "stage" && selector.entityId && ref.stageId === selector.stageId) {
       if (stage.stageId === 2 && heads.get(2) !== stage.revision) await this.checkExcerpt(scope.stages, actor, stage, selector.entityId);
       const current = aidtSavedEntityContext(stage, selector.entityId);
       const lineage = await entityLineage(stage,selector.entityId,exact,(source,id) => recoverProblemFraming(s,actor,source,id));
       loaded.push({ kind: "stage", stage, entityReferences:lineage.map(({step,revision,entityId})=>({stageId:step,revision,entityId})), payload: { ...current, ...(stage.stageId === 1 ? { fields:problemReference(current.fields ?? {}) } : {}), ...(lineage.length ? { upstream:lineage } : {}) } });
       continue;
     }
     if (selector.purpose === "summary" && stage.stageId === 6) {
       const ids = Object.keys(stage.content.draft.fields).filter(key=>key.startsWith("testGroup:")).map(key=>key.slice("testGroup:".length));
       const tests = [];
       const entityReferences = [];
       for (const id of ids) {
         if (!aidtSavedEntityTitle(stage,id,"stage")) continue;
         const sources = await entityLineage(stage,id,exact,(source,entity) => recoverProblemFraming(s,actor,source,entity));
         tests.push({测试:id,来源:sources});
         entityReferences.push(...sources.map(({step,revision,entityId})=>({stageId:step,revision,entityId})));
       }
       loaded.push({kind:"stage",stage,...(tests.length ? {lineage:tests,entityReferences} : {})});
       continue;
     }
     if (selector.purpose !== "stage" || !selector.sourceEntityId) {
       loaded.push({ kind: "stage", stage });
       continue;
     }
     const interviewRevision = selector.stageRevisions.find(ref => ref.stageId === 2)?.revision;
     const interview = interviewRevision ? await exact(2,interviewRevision) : null;
     const provenance = interview?.content.draft.fields["interviewRecord:" + selector.entityId];
     const savedProblem = stage.content.draft.fields["problemDraft:" + selector.sourceEntityId];
     if (!provenance || !savedProblem) return unavailable();
     let interviewRecord: { id?: string; topicRevision?: number; problemEntityId?: string };
     let problemFields: Record<string, string>;
     try {
       interviewRecord = JSON.parse(provenance);
       problemFields = JSON.parse(savedProblem);
     } catch { return unavailable(); }
     if (interviewRecord?.id !== selector.entityId || interviewRecord.topicRevision !== ref.revision
       || interviewRecord.problemEntityId !== selector.sourceEntityId || !problemFields?.roundCompletion
       || !problemFields.rewrittenTheme?.trim()) return unavailable();
     loaded.push({ kind: "stage", stage, payload: { draft: { fields: problemReference(problemFields) }, entityId: selector.sourceEntityId } });
   }
   const reflection=await this.checkReturn(scope.stages,actor,selector);if(reflection)loaded.push({kind:"return",stage:reflection.row,payload:reflection.payload});
   if(selector.purpose==="summary")for(const ref of selector.historyRevisions)loaded.push({kind:"history",stage:await this.exact(scope.stages,actor,ref.stageId,ref.revision)});
   const entitySources = selector.entityId && selector.purpose === "summary"
     ? loaded.map(source => ({ ...source, stage: { ...source.stage, content: { ...source.stage.content, summaryReport: undefined } } }))
     : loaded;
   const prepared=prepareAidtContext(selector,focus,entitySources,heads);return {...prepared,focusSkillVersionId:focus.skillVersionId};
  });
 }
 async persistIn(session:TenantSession,actor:AidtContextActor,input:{runId:string;inputMessageId:string;selectorHash:string;snapshot:AidtContextSnapshot}){
  if(!this.enabled())return unavailable();const selector=this.selector(input.snapshot.selector);if(selector.projectId!==actor.projectId||contextHash(aidtContextSelectorJson(selector))!==input.selectorHash)throw new AidtContextError("AIDT_CONTEXT_SNAPSHOT_MISMATCH");
  await this.store.saveIn(session,AidtStoredContextSnapshot.parse({orgId:actor.orgId,runId:input.runId,projectId:actor.projectId,threadId:actor.threadId,inputMessageId:input.inputMessageId,requestedBy:actor.userId,selectorHash:input.selectorHash,snapshotHash:contextHash(importSnapshotJson(input.snapshot)),snapshot:input.snapshot,preparedAt:this.clock()}));
 }
 private async verifyFrozenIn(session:TenantSession,actor:AidtContextActor,stored:Stored,scope:{stages:AidtStagesService;db:DatabasePort}){
  validateStoredAidtContext(stored);if(stored.orgId!==actor.orgId||stored.projectId!==actor.projectId||stored.threadId!==actor.threadId||stored.requestedBy!==actor.userId)return unavailable();
  const selector=stored.snapshot.selector;
  const focus=stored.snapshot.focus,expected=selector.purpose==="summary"?AIDT_SUMMARY_STABLE_NAME:AIDT_STAGE_IDENTITIES.find(s=>s.id===selector.stageId)!.skill;
  const skills=await new PgAgentRunRepository(scope.db).readPinnedSkills(actor.orgId,[focus.skillVersionId]),skill=skills[0];if(skills.length!==1||!skill?.package||skill.versionId!==focus.skillVersionId||skill.package.skillId!==focus.skillId||skill.stableName!==expected||focus.skillStableName!==expected)return unavailable();await verifyAidtPinnedSkill(skill,this.packs);
  for (const source of stored.snapshot.sources) {
   const stage = await this.exact(scope.stages, actor, source.stageId, source.revision);
   if (selector.purpose === "stage" && selector.stageId === 2 && selector.entityId && source.stageId === 2)
    await this.checkExcerpt(scope.stages, actor, stage, selector.entityId);
  }
  await this.checkReturn(scope.stages,actor,stored.snapshot.selector);
 }
 async revalidateIn(session:TenantSession,actor:AidtContextActor,stored:Stored){return this.timed(session,async s=>{const scope=await this.accessIn(s,actor,true);await this.verifyFrozenIn(s,actor,stored,scope);});}
 async revalidateAcceptedIn(session:TenantSession,actor:AidtContextActor,input:{runId:string;selectorHash:string}){return this.timed(session,async s=>{const scope=await this.accessIn(s,actor,true),guarded=await this.store.readIn(s,actor.orgId,input.runId);if(!guarded)throw new AidtContextError("AIDT_CONTEXT_SNAPSHOT_MISSING");const stored=this.disclose(guarded,actor,scope.decision);if(stored.selectorHash!==input.selectorHash||stored.requestedBy!==actor.userId)throw new AidtContextError("AIDT_CONTEXT_CONFLICT");await this.verifyFrozenIn(s,actor,stored,scope);});}
 resolve(orgId:OrgId,actor:Omit<AidtContextActor,"orgId">,guarded:Guarded<Stored>){return this.db.withTenant(orgId,s=>this.timed(s,async tx=>{const who={...actor,orgId},scope=await this.accessIn(tx,who,true),stored=this.disclose(guarded,who,scope.decision);if(stored.requestedBy!==actor.userId)return unavailable();await this.verifyFrozenIn(tx,who,stored,scope);return stored;}));}
 revalidate(orgId:OrgId,actor:Omit<AidtContextActor,"orgId">,stored:Stored){return this.db.withTenant(orgId,s=>this.revalidateIn(s,{...actor,orgId},stored));}
 append(orgId:OrgId,runId:string,event:import("@repo/contracts/aidt-run-context").AidtContextApplicationInput){if(!this.enabled())return Promise.reject(new AidtContextError("AIDT_CONTEXT_NOT_AVAILABLE"));return this.db.withTenant(orgId,s=>this.store.appendIn(s,orgId,runId,event));}
 async projectCompleted(orgId:OrgId,runId:string) {
  if (!this.enabled()) return;
  await this.db.withTenant(orgId,async s=>{
   const facts=await this.store.readScopeIn(s,orgId,runId);
   if (!facts) return;
   const actor={orgId,userId:facts.requestedBy,projectId:facts.projectId,threadId:facts.threadId};
   const scope=await this.accessIn(s,actor,true);
   const guarded=await this.store.readIn(s,orgId,runId);
   if (!guarded) return;
   const selector=this.disclose(guarded,actor,scope.decision).snapshot.selector;
   if (selector.purpose==="stage" && selector.entityId)
    await projectSavedSkillOutput(s,scope.stages,actor,scope.decision,selector.stageId,selector.entityId,runId);
  });
 }
 async reconcileEntity(actor:AidtContextActor,stageId:number,entityId:string) {
  if (!this.enabled()) return unavailable();
  return this.db.withTenant(actor.orgId,async s=>{
   const scope=await this.accessIn(s,actor,true);
   return projectSavedSkillOutput(s,scope.stages,actor,scope.decision,stageId,entityId);
  });
 }
 async receipt(actor:{orgId:OrgId;userId:string},runId:string){return this.db.withTenant(actor.orgId,s=>this.timed(s,async tx=>{
  const facts=await this.store.readScopeIn(tx,actor.orgId,runId);if(!facts)return unavailable();const who={...actor,projectId:facts.projectId,threadId:facts.threadId},scope=await this.accessIn(tx,who,false),guarded=await this.store.readIn(tx,actor.orgId,runId);if(!guarded)return unavailable();const stored=this.disclose(guarded,who,scope.decision),events=await this.store.eventsIn(tx,actor.orgId,runId),selector=stored.snapshot.selector;
  return AidtContextReceipt.parse({runId,projectId:stored.projectId,purpose:selector.purpose,...(selector.purpose==="stage"?{stageId:selector.stageId,...(selector.returnRevision!==undefined?{returnRevision:selector.returnRevision}:{})}:{}),skillVersionId:stored.snapshot.focus.skillVersionId,snapshotHash:stored.snapshotHash,preparedAt:stored.preparedAt,stageRevisions:selector.stageRevisions,entityReferences:stored.snapshot.entityReferences,historyRevisions:selector.purpose==="summary"?selector.historyRevisions:[],omissions:stored.snapshot.omissions,truncated:stored.snapshot.truncated,application:reduceAidtApplication(runId,events)});
 }));}
}
import { aidtContextSnapshotJson as importSnapshotJson } from "@repo/contracts/aidt-run-context";
