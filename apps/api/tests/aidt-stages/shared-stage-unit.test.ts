import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { operations, SaveInput, SharedStage, SourceStageRevision, StageContent, StageSummary, type SaveStageInput, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { AidtStagesService } from "../../src/application/aidt-stages/service";
import type { AidtStageRepository, StageActor, StageTransaction } from "../../src/application/aidt-stages/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
const actor:StageActor={orgId:toOrgId("org-a"),userId:"student-a",projectId:"project-a"};
function input(stageId=1,expectedRevision=0):SaveStageInput{return {projectId:actor.projectId,stageId,expectedRevision,operationId:randomUUID(),content:{schemaVersion:1,draft:{fields:{initial:"学生想法"},ideas:[],selectedIdeaId:""}},sourceStageRevisions:[]};}
function fixture(){
  const records:Array<{stage:SharedStageValue;requestKey:string;operationId:string;actor:string}>=[];
  const members=new Map([["student-a","owner"],["student-b","collaborator"]]);
  let state={status:"active",orgStatus:"active",aidt:true};let fail=false;let queue=Promise.resolve();
  const repo:AidtStageRepository={async inProject<T>(who:StageActor,fn:(tx:StageTransaction)=>Promise<T>):Promise<T>{
    const before=queue;let release!:()=>void;queue=new Promise<void>(r=>{release=r;});await before;
    try {if(fail)throw new Error("dependency down");const identity={
      findOrgMembership:async()=>({orgRole:who.userId==="admin"?"admin":"consultant",teamId:null}),
      findProjectMembership:async()=>null,
      findNonWorkshopStanding:async()=>({containerKind:"general",memberRole:members.get(who.userId)??null}),
      findBindings:async()=>new Map(),
    } as unknown as IdentityRepository;
    const ref={kind:"project" as const,id:who.projectId};const own=()=>records.filter(r=>r.stage.projectId===who.projectId&&who.orgId===actor.orgId);
    return await fn({identity,project:who.projectId===actor.projectId&&who.orgId===actor.orgId?state:null,
      current:async stageId=>guard(ref,own().filter(r=>r.stage.stageId===stageId).at(-1)?.stage??null),
      history:async(stageId,before,limit)=>guard(ref,own().filter(r=>r.stage.stageId===stageId&&(!before||r.stage.revision<before)).map(r=>r.stage).reverse().slice(0,limit)),
      receipt:async operationId=>{const v=own().find(r=>r.actor===who.userId&&r.operationId===operationId);return guard(ref,v?{stage:v.stage,requestKey:v.requestKey}:null);},
      hasImageAttachment:async ref=>ref.attachmentId==="sent-image"&&ref.threadId==="plenary"&&ref.name==="photo.png",
      hasRevision:async(stageId,revision)=>own().some(r=>r.stage.stageId===stageId&&r.stage.revision===revision),
      append:async(value,requestKey)=>{const stage={projectId:who.projectId,stageId:value.stageId,revision:value.expectedRevision+1,content:structuredClone(value.content),sourceStageRevisions:value.sourceStageRevisions,updatedBy:who.userId,updatedAt:new Date().toISOString()};records.push({stage,requestKey,actor:who.userId,operationId:value.operationId});return guard(ref,stage);},
    });}finally{release();}
  }};
  return {service:new AidtStagesService(repo,()=>true),repo,records,members,setState:(v:Partial<typeof state>)=>{state={...state,...v};},fail:()=>{fail=true;}};
}
describe("AIDT shared stage transaction behavior (in-memory ports, not PG evidence)",()=>{
  it("defaults off with no storage touched",async()=>{const f=fixture();f.fail();await expect(new AidtStagesService(f.repo).get(actor,1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it("stores complete student draft and discovery cards, shared by another member",async()=>{const f=fixture();const v=input(2);v.content.draft.discoveryCards=[{id:"d1",participantCode:"P1",headline:"学生概括",headlineKind:"student-summary",context:"情境",quote:"",sourceRef:"缺口待补",photoRef:""}];await f.service.save(actor,v);expect((await f.service.get({...actor,userId:"student-b"},2)).stage).toMatchObject({revision:1,updatedBy:"student-a",content:v.content});expect(f.records).toHaveLength(1);});
  it("summary has all six stages, missing stages remain revision zero",async()=>{const f=fixture();const out=await f.service.list(actor);expect(out.items).toHaveLength(6);expect(out.items.every(r=>r.revision===0&&r.updatedAt===null)).toBe(true);});
  it("stale revision returns authorized current and preserves prior record",async()=>{const f=fixture();await f.service.save(actor,input());await expect(f.service.save(actor,input())).rejects.toMatchObject({reasonCode:"AIDT_STAGE_REVISION_CONFLICT",current:{revision:1}});expect(f.records).toHaveLength(1);});
  it("serializes simultaneous base-zero writers, exactly one succeeds",async()=>{const f=fixture();const out=await Promise.allSettled([f.service.save(actor,input()),f.service.save({...actor,userId:"student-b"},input())]);expect(out.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(f.records).toHaveLength(1);});
  it("replays the original revision even after a newer save",async()=>{const f=fixture();const first=input();const saved=await f.service.save(actor,first);await f.service.save(actor,input(1,1));expect(await f.service.save(actor,first)).toEqual({...saved,replayed:true});expect(f.records).toHaveLength(2);});
  it("same actor operation id with other content or stage conflicts",async()=>{const f=fixture();const v=input();await f.service.save(actor,v);await expect(f.service.save(actor,{...v,stageId:2})).rejects.toMatchObject({reasonCode:"AIDT_STAGE_OPERATION_CONFLICT"});});
  it("other actor can use same operation id independently",async()=>{const f=fixture();const v=input();await f.service.save(actor,v);await f.service.save({...actor,userId:"student-b"},{...v,expectedRevision:1});expect(f.records).toHaveLength(2);});
  it.each(["admin","outsider"])("%s without actual project membership cannot read",async userId=>{await expect(fixture().service.get({...actor,userId},1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it("revoked member cannot replay an earlier accepted operation",async()=>{const f=fixture();const v=input();await f.service.save(actor,v);f.members.delete(actor.userId);await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it.each([{status:"archived"},{orgStatus:"disabled"}])("lifecycle read-only is checked again for retries",async state=>{const f=fixture();const v=input();await f.service.save(actor,v);f.setState(state);await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_READONLY"});expect((await f.service.get(actor,1)).stage?.revision).toBe(1);});
  it("non AIDT project and cross project return same inaccessible response",async()=>{const f=fixture();f.setState({aidt:false});await expect(f.service.get(actor,1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});await expect(f.service.get({...actor,projectId:"other"},1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it("cross tenant cannot see stage",async()=>{await expect(fixture().service.get({...actor,orgId:toOrgId("org-b")},1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it("validates explicit earlier revision sources, never creates missing material",async()=>{const f=fixture();const v=input(2);v.sourceStageRevisions=[{stageId:1,revision:1}];await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_INVALID"});await f.service.save(actor,input());await expect(f.service.save(actor,v)).resolves.toMatchObject({stage:{sourceStageRevisions:v.sourceStageRevisions}});});
  it("history is immutable and paginates descending without overlap",async()=>{const f=fixture();for(let n=0;n<3;n++)await f.service.save(actor,input(1,n));const page=await f.service.history(actor,1,undefined,2);expect(page.items.map(r=>r.revision)).toEqual([3,2]);expect(page.nextBeforeRevision).toBe(2);expect((await f.service.history(actor,1,page.nextBeforeRevision!,2)).items.map(r=>r.revision)).toEqual([1]);});
  it("writes the last PostgreSQL integer revision and rejects another append before storage",async()=>{
    const f=fixture(),max=2147483647,prior=input(1,max-2);
    const stage={projectId:actor.projectId,stageId:1,revision:max-1,content:prior.content,sourceStageRevisions:[],updatedBy:actor.userId,updatedAt:new Date().toISOString()};
    f.records.push({stage,requestKey:"synthetic-boundary-fixture",operationId:prior.operationId,actor:actor.userId});
    expect((await f.service.save(actor,input(1,max-1))).stage.revision).toBe(max);
    const storage=vi.spyOn(f.repo,"inProject");
    expect(()=>f.service.save(actor,input(1,max))).toThrowError("AIDT_STAGE_INVALID");
    expect(storage).not.toHaveBeenCalled();expect(f.records).toHaveLength(2);
  });
  it("rejects out-of-range history, draft sources and report sources before any storage",()=>{
    const f=fixture(),storage=vi.spyOn(f.repo,"inProject"),revision=2147483648;
    expect(()=>f.service.history(actor,1,revision)).toThrowError("AIDT_STAGE_INVALID");
    expect(()=>f.service.save(actor,{...input(2),sourceStageRevisions:[{stageId:1,revision}]})).toThrowError("AIDT_STAGE_INVALID");
    const report=input(6);report.content.summaryReport={markdown:"学生报告",sourceStageRevisions:[{stageId:1,revision}]};
    expect(()=>f.service.save(actor,report)).toThrowError("AIDT_STAGE_INVALID");
    expect(storage).not.toHaveBeenCalled();expect(f.records).toHaveLength(0);
  });
  it("accepts an authorized sent project image reference, rejects unverifiable private references",async()=>{const f=fixture();const v=input(4);v.content.draft.ideas=[{id:"i",title:"点子",description:"说明",imageAttachment:{attachmentId:"private-or-other-project",threadId:"plenary",name:"photo.png"}}];await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_INVALID"});v.content.draft.ideas[0]!.imageAttachment!.attachmentId="sent-image";expect((await f.service.save(actor,v)).stage.content.draft.ideas[0]!.imageAttachment).toEqual(v.content.draft.ideas[0]!.imageAttachment);});
  it("restores an authorized discovery-card photo reference without changing evidence status",async()=>{const f=fixture();const v=input(2);v.content.draft.discoveryCards=[{id:"p1",participantCode:"P1",headline:"学生概括",headlineKind:"student-summary",context:"待核对",quote:"",sourceRef:"",photoRef:"",photoAttachment:{attachmentId:"sent-image",threadId:"plenary",name:"photo.png"}}];await f.service.save(actor,v);expect((await f.service.get({...actor,userId:"student-b"},2)).stage?.content.draft.discoveryCards).toEqual(v.content.draft.discoveryCards);});
  it.each([{attachmentId:"other-project-image",threadId:"plenary",name:"photo.png"},{attachmentId:"sent-image",threadId:"private-thread",name:"photo.png"},{attachmentId:"sent-image",threadId:"plenary",name:"forged.png"}])("rejects non-shared discovery-card photo reference %o",async photoAttachment=>{const f=fixture();const v=input(2);v.content.draft.discoveryCards=[{id:"p1",participantCode:"P1",headline:"",headlineKind:"quote",context:"",quote:"",sourceRef:"",photoRef:"",photoAttachment}];await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_INVALID"});expect(f.records).toHaveLength(0);});
  it("saves one editable stage-six report with actual source history including stage six",async()=>{const f=fixture();await f.service.save(actor,input(1));await f.service.save(actor,input(6));const v=input(6,1);v.content.summaryReport={markdown:"# 小组研究档案\n学生整理，测试材料仍有缺口。",sourceStageRevisions:[{stageId:1,revision:1},{stageId:6,revision:1}]};await f.service.save(actor,v);expect((await f.service.get({...actor,userId:"student-b"},6)).stage?.content.summaryReport).toEqual(v.content.summaryReport);expect((await f.service.history(actor,6)).items[1]!.content).not.toHaveProperty("summaryReport");const next=input(6,2);next.content.summaryReport={...v.content.summaryReport,markdown:"学生修订后的研究档案"};await f.service.save({...actor,userId:"student-b"},next);expect((await f.service.history(actor,6)).items.map(r=>r.revision)).toEqual([3,2,1]);});
  it("does not save a report with fabricated stage revision sources",async()=>{const f=fixture();const v=input(6);v.content.summaryReport={markdown:"待核对",sourceStageRevisions:[{stageId:1,revision:99}]};await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_INVALID"});expect(f.records).toHaveLength(0);});
  it("report cannot cite its not-yet-created revision",async()=>{const f=fixture();const v=input(6);v.content.summaryReport={markdown:"待补材料",sourceStageRevisions:[{stageId:6,revision:1}]};await expect(f.service.save(actor,v)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_INVALID"});});
  it("reused report operation with changed markdown conflicts and protects original",async()=>{const f=fixture();const v=input(6);v.content.summaryReport={markdown:"原文",sourceStageRevisions:[]};await f.service.save(actor,v);await expect(f.service.save(actor,{...v,content:{...v.content,summaryReport:{markdown:"覆盖",sourceStageRevisions:[]}}})).rejects.toMatchObject({reasonCode:"AIDT_STAGE_OPERATION_CONFLICT"});expect((await f.service.get(actor,6)).stage?.content.summaryReport?.markdown).toBe("原文");});
  it("oversized direct service request returns explicit 413 reason before storage",()=>{const v=input();v.content.draft.fields=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),"中".repeat(6000)]));expect(()=>fixture().service.save(actor,v)).toThrowError("AIDT_STAGE_TOO_LARGE");});
  it("dependency outage is unavailable, never an empty state",async()=>{const f=fixture();f.fail();await expect(f.service.list(actor)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_UNAVAILABLE"});});
});
describe("shared stage contract",()=>{
  it.each([
    ["source revision",(revision:number)=>SourceStageRevision.safeParse({stageId:1,revision}).success],
    ["saved revision",(revision:number)=>SharedStage.safeParse({projectId:actor.projectId,stageId:1,revision,content:input().content,sourceStageRevisions:[],updatedBy:actor.userId,updatedAt:"2026-11-17T00:00:00.000Z"}).success],
    ["stage summary",(revision:number)=>StageSummary.safeParse({stageId:1,revision,updatedBy:null,updatedAt:null}).success],
    ["history cursor",(beforeRevision:number)=>operations.history.in.safeParse({projectId:actor.projectId,stageId:1,beforeRevision}).success],
    ["next history cursor",(nextBeforeRevision:number)=>operations.history.out.safeParse({items:[],nextBeforeRevision}).success],
    ["draft source",(revision:number)=>SaveInput.safeParse({...input(2),sourceStageRevisions:[{stageId:1,revision}]}).success],
    ["report source",(revision:number)=>SaveInput.safeParse({...input(6),content:{...input(6).content,summaryReport:{markdown:"学生报告",sourceStageRevisions:[{stageId:1,revision}]}}}).success],
  ] as const)("accepts the PostgreSQL maximum and rejects overflow for %s",(_name,accepts)=>{expect(accepts(2147483647)).toBe(true);expect(accepts(2147483648)).toBe(false);});
  it("reserves one integer revision for save and preserves the initial zero revision",()=>{
    expect(SaveInput.safeParse(input(1,0)).success).toBe(true);
    expect(SaveInput.safeParse(input(1,2147483646)).success).toBe(true);
    expect(SaveInput.safeParse(input(1,2147483647)).success).toBe(false);
    expect(SaveInput.safeParse(input(1,2147483648)).success).toBe(false);
    expect(StageSummary.safeParse({stageId:1,revision:0,updatedBy:null,updatedAt:null}).success).toBe(true);
    expect(SourceStageRevision.safeParse({stageId:1,revision:0}).success).toBe(false);
  });
  it("allows incomplete student drafts without stage completion fields",()=>{expect(StageContent.parse({schemaVersion:1,draft:{fields:{},ideas:[],selectedIdeaId:""}})).not.toHaveProperty("confirmed");});
  it.each(["data:image/png;base64,abc","blob:https://test/uuid"])("rejects unuploaded image %s",image=>{const v=input();expect(SaveInput.safeParse({...v,content:{...v.content,draft:{...v.content.draft,ideas:[{id:"i",title:"点子",description:"说明",image}]}}}).success).toBe(false);});
  it("rejects arbitrary image URL until a sent attachment reference is selected",()=>{const v=input();expect(SaveInput.safeParse({...v,content:{...v.content,draft:{...v.content.draft,ideas:[{id:"i",title:"",description:"",image:"https://elsewhere/image.png"}]}}}).success).toBe(false);});
  it("rejects unsupported keys, invalid source stage, oversized text and non UUID",()=>{expect(SaveInput.safeParse({...input(),operationId:"made-up"}).success).toBe(false);expect(SaveInput.safeParse({...input(),confirmed:true}).success).toBe(false);expect(SaveInput.safeParse({...input(),sourceStageRevisions:[{stageId:1,revision:1}]}).success).toBe(false);const v=input();v.content.draft.fields.initial="x".repeat(6001);expect(SaveInput.safeParse(v).success).toBe(false);});
  it("rejects excess UTF8 bytes even when character count is below limit",()=>{const v=input();v.content.draft.fields=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),"中".repeat(6000)]));expect(SaveInput.safeParse(v).success).toBe(false);});
  it("allows old content without a report and rejects report on any stage before six",()=>{expect(SaveInput.safeParse(input(6)).success).toBe(true);for(let stageId=1;stageId<6;stageId++){const v=input(stageId);v.content.summaryReport={markdown:"报告",sourceStageRevisions:[]};expect(SaveInput.safeParse(v).success).toBe(false);}});
  it("limits report text and rejects duplicate or more than six source stages",()=>{const v=input(6);v.content.summaryReport={markdown:"x".repeat(100001),sourceStageRevisions:[]};expect(SaveInput.safeParse(v).success).toBe(false);v.content.summaryReport={markdown:"报告",sourceStageRevisions:[{stageId:1,revision:1},{stageId:1,revision:2}]};expect(SaveInput.safeParse(v).success).toBe(false);v.content.summaryReport.sourceStageRevisions=Array.from({length:7},(_,i)=>({stageId:(i%6)+1,revision:1}));expect(SaveInput.safeParse(v).success).toBe(false);});
  it("caps history pagination to 100",()=>{expect(operations.history.in.safeParse({projectId:actor.projectId,stageId:1,limit:101}).success).toBe(false);});
});
