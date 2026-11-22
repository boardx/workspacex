import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtIdeaDirectory } from "@/features/aidt/components/aidt-idea-directory";
import { createAidtIdea, readAidtIdeaSheetIds } from "@/features/aidt/lib/aidt-idea-handoff";
import { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSaveStageInput, AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
function fixture(count:number):AidtUiStageDraft{return {fields:{},selectedIdeaId:"",ideas:Array.from({length:count},(_,i)=>({id:`idea-${i}`,title:`现有点子 ${i+1}`,description:"学生产生的点子"}))};}
afterEach(cleanup);
for(const count of [8,26])it(`allows normal creation after ${count} saved candidates`,()=>{const draft=fixture(count);render(<AidtIdeaDirectory draft={draft} saved={draft} href={id=>`/aidt/qa?step=4&entity=${id}`} update={()=>{}} readOnly={false}/>);expect(screen.getByRole("button",{name:"新建点子"})).toBeEnabled();expect(createAidtIdea(draft,"new-idea","新点子").ideas).toHaveLength(count+1);});
it("retains the canonical 100 idea boundary",()=>{const draft=fixture(100);render(<AidtIdeaDirectory draft={draft} saved={draft} href={id=>id} update={()=>{}} readOnly={false}/>);expect(screen.getByRole("button",{name:"新建点子"})).toBeDisabled();expect(createAidtIdea(draft,"new-idea","新点子")).toBe(draft);expect(StageDraft.safeParse(draft).success).toBe(true);expect(StageDraft.safeParse(fixture(101)).success).toBe(false);});

const api=vi.hoisted(()=>({read:vi.fn(),save:vi.fn()}));
vi.mock("@/features/aidt/lib/live-aidt-stages",()=>({readAidtStage:api.read,saveAidtStage:api.save}));
const source={id:"hmw-historical",revision:7,text:"我们如何让新生安心尝试？"};
const otherSource={id:"hmw-other",revision:8,text:"我们如何改善排队？"};
let persisted:AidtSharedStage;
const opened=vi.fn();
function saved(count:number):AidtSharedStage{return {projectId:"qa-project",stageId:4,revision:12,content:{schemaVersion:1,draft:StageDraft.parse(fixture(count))},sourceStageRevisions:[],updatedBy:"qa-member",updatedAt:"2026-11-22T00:00:00.000Z"};}
function Host({readOnly=false}:{readOnly?:boolean}){
 const [drafts,setDrafts]=React.useState(()=>({...emptyAidtUiDrafts(),4:structuredClone(persisted.content.draft)}));
 const scope=React.useMemo(()=>({projectId:"qa-project",orgId:"qa-org",userId:"qa-member",sessionToken:"synthetic"}),[]);
 const onHydrate=React.useCallback((id:number,draft:AidtUiStageDraft)=>setDrafts(old=>({...old,[id]:StageDraft.parse(draft)})),[]);
 const controller=useAidtSharedStages({enabled:true,scope,lifecycleKey:"qa-scope",stageId:4,drafts,canWrite:!readOnly,onHydrate});
 return <><output data-testid="shared-ready">{controller.read?.phase}</output><AidtIdeaDirectory draft={drafts[4]!} saved={controller.server?.content.draft} href={id=>`/aidt/qa-project?step=4&entity=${id}`} update={change=>setDrafts(old=>({...old,4:StageDraft.parse(change(old[4]!))}))} readOnly={readOnly} saveDraft={controller.saveDraft} onCreated={opened} sources={[source,otherSource]}/></>;
}
beforeEach(()=>{vi.clearAllMocks();persisted=saved(8);api.read.mockImplementation(async(_project:string,id:number)=>({stage:id===4?structuredClone(persisted):null}));api.save.mockImplementation(async(input:AidtSaveStageInput)=>{expect(input.expectedRevision).toBe(persisted.revision);persisted={...persisted,revision:persisted.revision+1,content:structuredClone(input.content),sourceStageRevisions:input.sourceStageRevisions};return {stage:structuredClone(persisted)};});});
async function ready(){await waitFor(()=>expect(screen.getByTestId("shared-ready")).toHaveTextContent("ready"));}
async function openCreate(title:string){fireEvent.click(screen.getByRole("button",{name:"新建点子"}));const dialog=within(await screen.findByRole("dialog",{name:"新建点子"}));fireEvent.change(dialog.getByRole("textbox",{name:"点子名称"}),{target:{value:title}});return dialog;}
for(const count of[8,26])it(`persists manual idea ${count+1} through the actual shared controller and reloads its saved card`,async()=>{persisted=saved(count);const view=render(<Host/>);await ready();const dialog=await openCreate("第"+(count+1)+"个学生点子");expect(dialog.getByRole("combobox",{name:"来源 HMW"})).toHaveValue("");expect(dialog.getByRole("button",{name:"保存点子"})).toBeDisabled();expect(api.save).not.toHaveBeenCalled();fireEvent.change(dialog.getByRole("combobox",{name:"来源 HMW"}),{target:{value:source.id}});await act(async()=>{fireEvent.click(dialog.getByRole("button",{name:"保存点子"}));});expect(api.save).toHaveBeenCalledOnce();expect(opened).toHaveBeenCalledOnce();expect(persisted.content.draft.ideas).toHaveLength(count+1);const created=persisted.content.draft.ideas.at(-1)!;expect(JSON.parse(persisted.content.draft.fields["ideaHmwSource:"+created.id]!)).toEqual(source);expect(persisted.sourceStageRevisions).toContainEqual({stageId:3,revision:7});expect(StageDraft.safeParse(persisted.content.draft).success).toBe(true);view.unmount();render(<Host/>);await ready();expect(await screen.findByRole("link",{name:`打开「${created.title}」对话`})).toHaveAttribute("href",`/aidt/qa-project?step=4&entity=${created.id}`);expect(api.save).toHaveBeenCalledOnce();});
it("cancels new creation without saving or navigating",async()=>{render(<Host/>);await ready();const dialog=await openCreate("取消的点子");fireEvent.change(dialog.getByRole("combobox",{name:"来源 HMW"}),{target:{value:source.id}});fireEvent.click(dialog.getByRole("button",{name:"取消"}));expect(screen.queryByRole("dialog")).toBeNull();expect(api.save).not.toHaveBeenCalled();expect(opened).not.toHaveBeenCalled();expect(persisted.content.draft.ideas).toHaveLength(8);});
it("never navigates or creates a saved card after an unknown save outcome",async()=>{api.save.mockRejectedValueOnce(new Error("unknown HTTP outcome"));render(<Host/>);await ready();const dialog=await openCreate("未知保存结果");fireEvent.change(dialog.getByRole("combobox",{name:"来源 HMW"}),{target:{value:source.id}});await act(async()=>{fireEvent.click(dialog.getByRole("button",{name:"保存点子"}));});expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");expect(opened).not.toHaveBeenCalled();expect(screen.queryByRole("link",{name:"打开「未知保存结果」对话"})).toBeNull();expect(persisted.content.draft.ideas).toHaveLength(8);});
it("read-only member has no create/edit/delete operation and does not save",async()=>{render(<Host readOnly/>);await ready();expect(screen.queryByRole("button",{name:"新建点子"})).toBeNull();expect(screen.queryByRole("button",{name:/编辑点子|删除点子/})).toBeNull();expect(api.save).not.toHaveBeenCalled();expect(opened).not.toHaveBeenCalled();});

it("keeps the independent maximum-eight formal-sheet selection rule",()=>{const draft=fixture(9);draft.fields.ideaSheetIds=JSON.stringify(draft.ideas.slice(0,8).map(idea=>idea.id));expect(readAidtIdeaSheetIds(draft)).toHaveLength(8);draft.fields.ideaSheetIds=JSON.stringify(draft.ideas.map(idea=>idea.id));expect(readAidtIdeaSheetIds(draft)).toEqual([]);});
