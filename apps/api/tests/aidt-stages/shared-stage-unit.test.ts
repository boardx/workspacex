import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { operations, SaveInput, SharedStage, SourceStageRevision, StageContent, StageSummary, type SaveStageInput, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { AidtStagesService } from "../../src/application/aidt-stages/service";
import { aidtSavedEntityContext } from "../../src/application/aidt-stages/entity-thread";
import type { AidtStageRepository, StageActor, StageTransaction } from "../../src/application/aidt-stages/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
const actor:StageActor={orgId:toOrgId("org-a"),userId:"student-a",projectId:"project-a"};
function input(stageId=1,expectedRevision=0):SaveStageInput{return {projectId:actor.projectId,stageId,expectedRevision,operationId:randomUUID(),content:{schemaVersion:1,draft:{fields:{initial:"学生想法"},ideas:[],selectedIdeaId:""}},sourceStageRevisions:[]};}
function fixture(){
  const entityThreads = new Map<string, string>();
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
      ensureEntityThread: async (threadId, title, syncInterviewTitle) => {
        if (syncInterviewTitle || !entityThreads.has(threadId)) entityThreads.set(threadId, title);
        return guard(ref, { threadId });
      },
      current:async stageId=>guard(ref,own().filter(r=>r.stage.stageId===stageId).at(-1)?.stage??null),
      revision:async(stageId,revision)=>guard(ref,own().find(r=>r.stage.stageId===stageId&&r.stage.revision===revision)?.stage??null),
      history:async(stageId,before,limit)=>guard(ref,own().filter(r=>r.stage.stageId===stageId&&(!before||r.stage.revision<before)).map(r=>r.stage).reverse().slice(0,limit)),
      receipt:async operationId=>{const v=own().find(r=>r.actor===who.userId&&r.operationId===operationId);return guard(ref,v?{stage:v.stage,requestKey:v.requestKey}:null);},
      hasImageAttachment:async ref=>ref.attachmentId==="sent-image"&&ref.threadId==="plenary"&&ref.name==="photo.png",
      hasRevision:async(stageId,revision)=>own().some(r=>r.stage.stageId===stageId&&r.stage.revision===revision),
      append:async(value,requestKey)=>{const stage={projectId:who.projectId,stageId:value.stageId,revision:value.expectedRevision+1,content:structuredClone(value.content),sourceStageRevisions:value.sourceStageRevisions,updatedBy:who.userId,updatedAt:new Date().toISOString()};records.push({stage,requestKey,actor:who.userId,operationId:value.operationId});return guard(ref,stage);},
    });}finally{release();}
  }};
  return {service:new AidtStagesService(repo,()=>true),repo,records,members,entityThreads,setState:(v:Partial<typeof state>)=>{state={...state,...v};},fail:()=>{fail=true;}};
}
describe("AIDT shared stage transaction behavior (in-memory ports, not PG evidence)",()=>{
  it("defaults off with no storage touched",async()=>{const f=fixture();f.fail();await expect(new AidtStagesService(f.repo).get(actor,1)).rejects.toMatchObject({reasonCode:"AIDT_STAGE_NOT_FOUND"});});
  it("stores complete student draft and discovery cards, shared by another member",async()=>{const f=fixture();const v=input(2);v.content.draft.discoveryCards=[{id:"d1",participantCode:"P1",headline:"学生概括",headlineKind:"student-summary",context:"情境",quote:"",sourceRef:"缺口待补",photoRef:""}];await f.service.save(actor,v);expect((await f.service.get({...actor,userId:"student-b"},2)).stage).toMatchObject({revision:1,updatedBy:"student-a",content:v.content});expect(f.records).toHaveLength(1);});
  it("binds ten saved interviews exactly once and retains bindings across actors and renames", async () => {
    const f = fixture();
    const saved = input(2);
    const ids = Array.from({ length: 10 }, () => randomUUID());
    ids.forEach((id, index) => {
      saved.content.draft.fields["interviewRecord:" + id] = JSON.stringify({ version: 1, id, code: "U" + (index + 1) });
    });
    await f.service.save(actor, saved);
    const open = (entityId: string, who = actor) => f.service.entityThread(who, { stageId: 2, entityId, purpose: "stage" });
    const bindings = await Promise.all(ids.map(async id => {
      const [left, right] = await Promise.all([open(id), open(id, { ...actor, userId: "student-b" })]);
      expect(left).toEqual(right);
      return left.threadId;
    }));
    expect(new Set(bindings).size).toBe(10);
    expect(f.entityThreads.size).toBe(10);

    const changed = input(2, 1);
    changed.content.draft.fields = { ...saved.content.draft.fields };
    changed.content.draft.fields["interviewRecord:" + ids[0]!] = JSON.stringify({ version: 1, id: ids[0], code: "U01", displayName: "小林" });
    changed.content.draft.fields["interviewArchived:" + ids[1]!] = "true";
    await f.service.save(actor, changed);
    expect(await open(ids[0]!)).toEqual({ threadId: bindings[0] });
    expect(f.entityThreads.get(bindings[0]!)).toBe("U01 · 小林");
    await expect(open(ids[1]!)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_NOT_FOUND" });
    await expect(open("absent")).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_NOT_FOUND" });
    await expect(open(ids[0]!, { ...actor, userId: "outsider" })).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_NOT_FOUND" });
    expect(f.entityThreads.size).toBe(10);
  });
  it("projects only the selected interview fields and withholds unrelated evidence from Skill context", async () => {
    const { service } = fixture();
    const draft = input(2);
    draft.content.draft.fields = {
      "interviewRecord:first": JSON.stringify({ id: "first", code: "U01", original: "原始问题", consent: { notes: true } }),
      "interviewRecord:next": JSON.stringify({ id: "next", code: "U02", original: "另一个人的问题" }),
      "interviewTranscript:first": "需要单独授权的材料",
      guide: "归属不明的历史提纲",
    };
    const { stage } = await service.save(actor, draft);
    expect(aidtSavedEntityContext(stage, "first")).toEqual({
      entityId: "first", fields: { code: "U01", original: "原始问题" }, finding: undefined,
    });
  });
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
  it("pins the actual selected HMW at the authorized historical stage-3 revision", async () => {
    const f = fixture();
    const definition = input(3);
    definition.content.draft.fields = { definitionHmwId: "h-1", hmw: "我们如何理解校园菜单？" };
    await f.service.save(actor, definition);
    const newer = input(3, 1);
    newer.content.draft.fields = { definitionHmwId: "h-2", hmw: "我们如何比较口味？" };
    await f.service.save(actor, newer);
    const ideate = input(4);
    const hmw = { id: "h-1", text: "我们如何理解校园菜单？", revision: 1 };
    ideate.content.draft.fields.ideaHmwSource = JSON.stringify(hmw);
    await expect(f.service.save(actor, ideate)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    ideate.sourceStageRevisions = [{ stageId: 3, revision: 1 }];
    ideate.content.draft.fields.ideaHmwSource = JSON.stringify({ ...hmw, id: "h-2" });
    await expect(f.service.save(actor, ideate)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    ideate.content.draft.fields.ideaHmwSource = JSON.stringify({ ...hmw, text: "篡改文字" });
    await expect(f.service.save(actor, ideate)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    ideate.content.draft.fields.ideaHmwSource = JSON.stringify(hmw);
    const saved = await f.service.save(actor, ideate);
    expect(saved.stage.sourceStageRevisions).toEqual([{ stageId: 3, revision: 1 }]);
  });
  it("pins a chosen confirmed HMW to an independently scoped brainstorming session", async () => {
    const f = fixture();
    const definition = input(3);
    definition.content.draft.fields = {
      definitionHmwId: "one", hmw: "当前选中的 HMW",
      "definitionHmw:two": JSON.stringify({ id: "two", text: "另一个确认的 HMW", confirmed: true, archived: false }),
    };
    await f.service.save(actor, definition);
    const ideate = input(4);
    const id = "brainstorm-a";
    const source = { id: "two", revision: 1, text: "另一个确认的 HMW" };
    const key = "ideaBrainstorm:" + id;
    const session = { id, source, method: "reverse", count: 5, candidates: [] };
    ideate.content.draft.fields[key] = JSON.stringify({ ...session, source: { ...source, text: "篡改原文" } });
    await expect(f.service.save(actor, ideate)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    ideate.content.draft.fields[key] = JSON.stringify(session);
    const { stage } = await f.service.save(actor, ideate);
    const first = await f.service.entityThread(actor, { stageId: 4, entityId: id, purpose: "stage" });
    const peer = await f.service.entityThread({ ...actor, userId: "student-b" }, { stageId: 4, entityId: id, purpose: "stage" });
    expect(first).toEqual(peer);
    expect(aidtSavedEntityContext(stage, id)).toMatchObject({ entityId: id, brainstorm: { method: "逆向思考", hmw: source } });
    const changed = input(4, 1);
    changed.content.draft.fields[key] = JSON.stringify({ ...session, method: "free" });
    await expect(f.service.save(actor, changed)).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    const selected = input(4, 1);
    selected.sourceStageRevisions = [{ stageId: 3, revision: 1 }];
    selected.content.draft.fields[key] = JSON.stringify({ ...session, candidates: ["idea-a"] });
    selected.content.draft.fields.ideaHmwSource = JSON.stringify(source);
    selected.content.draft.fields.ideaHandoffIds = JSON.stringify(["idea-a"]);
    selected.content.draft.fields.ideaBrainstormHandoff = JSON.stringify({ sessionId: id, ids: ["idea-a"] });
    selected.content.draft.ideas = [{ id: "idea-a", title: "价格标牌", description: "分别列出价格及样式。" }];
    await expect(f.service.save(actor, selected)).resolves.toMatchObject({ stage: { revision: 2 } });
  });
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

describe("AIDT report entity receipts", () => {
  it("isolates report drafts and freezes one exact revision per confirmation", async () => {
    const { service } = fixture();
    await service.save(actor, input());
    const stageSix = input(6);
    await service.save(actor, stageSix);
    const sourceStageRevisions = [{ stageId: 1, revision: 1 }];
    const reportA = { markdown: "# 小组报告 A", sourceStageRevisions };
    const reportB = { markdown: "# 小组报告 B", sourceStageRevisions };
    const saveReport = (reportEntityId: string, expectedRevision: number, summaryReport: NonNullable<SaveStageInput["content"]["summaryReport"]>) =>
      service.save(actor, { ...stageSix, operationId: randomUUID(), reportEntityId, expectedRevision, content: { ...stageSix.content, summaryReport } });

    await expect(saveReport("report-a", 1, { ...reportA, confirmedAtRevision: 2 })).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    await saveReport("report-a", 1, reportA);
    await saveReport("report-b", 2, reportB);
    await expect(saveReport("report-a", 3, { ...reportB, confirmedAtRevision: 4 })).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
    const confirmedA = { ...reportA, confirmedAtRevision: 4 };
    await expect(saveReport("report-a", 3, confirmedA)).resolves.toMatchObject({
      stage: { revision: 4, content: { reports: { "report-a": confirmedA, "report-b": reportB } } },
    });

    const learningContent = draftForStageSix();
    const nextLearning = await service.save(actor, { ...input(6, 4), content: learningContent });
    expect(nextLearning.stage.content.reports).toEqual({ "report-a": confirmedA, "report-b": reportB });
    const editedA = { ...reportA, markdown: "# A 的后续草稿" };
    const saved = await service.save(actor, {
      ...input(6, 5), reportEntityId: "report-a", content: { ...learningContent, summaryReport: editedA },
    });
    expect(saved.stage.content.reports).toEqual({ "report-a": editedA, "report-b": reportB });
    expect(saved.stage.content.summaryReport).toBeUndefined();
    const history = await service.history({ ...actor, userId: "student-b" }, 6, 5, 1);
    expect(history.items[0]?.content.reports?.["report-a"]).toEqual(confirmedA);
    expect(history.items[0]?.content.reports?.["report-b"]).toEqual(reportB);
  });

  it("rejects report-only writes that simultaneously change a learning draft", async () => {
    const { service } = fixture();
    await service.save(actor, input(6));
    await expect(service.save(actor, {
      ...input(6, 1),
      reportEntityId: "new-report",
      content: { ...draftForStageSix(), summaryReport: { markdown: "# Report", sourceStageRevisions: [] } },
    })).rejects.toMatchObject({ reasonCode: "AIDT_STAGE_INVALID" });
  });
});
function draftForStageSix(): SaveStageInput["content"] {
  return { schemaVersion: 1, draft: { fields: { reflection: "迭代反馈" }, ideas: [], selectedIdeaId: "" } };
}
