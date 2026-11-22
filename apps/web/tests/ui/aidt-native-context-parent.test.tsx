import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import { chooseAidtDefinitionHmw, saveAidtDefinitionHmw, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { SharedStage } from "@repo/contracts/aidt-stages";
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({isAidtModuleEnabled:()=>true}));
const mocks = vi.hoisted(() => ({ search: "", push: vi.fn(), list: vi.fn(), chat: vi.fn(), rec: vi.fn(), design: vi.fn(), resources: vi.fn(), read:vi.fn(), readRevision:vi.fn(), save:vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: React.ComponentType<any> }>) => {
  const Lazy = React.lazy(async () => ({ default: await load() as unknown as React.ComponentType<any> }));
  return function Dynamic(props: any) { return <React.Suspense fallback={<p>加载中</p>}><Lazy {...props} /></React.Suspense>; };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/project-aidt-chat", () => ({ ProjectAidtChat: (props: any) => { mocks.chat(props); return <div data-testid="native-chat">{props.hostPanel?.open && props.hostPanel.content}</div>; } }));
vi.mock("@/components/rec/transcription-history", () => ({ TranscriptionHistory: (props: any) => { mocks.rec(props); return <div data-testid="native-rec" />; } }));
vi.mock("@/components/design-loop/detail-screen", () => ({ DesignDetailScreen: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/features/aidt/components/aidt-design-workspace", () => ({ AidtDesignWorkspace: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/components/project/project-conversations", () => ({ ProjectConversations: () => <div data-testid="readonly-conversations" /> }));
vi.mock("@/components/project/project-evidence-section", () => ({ ProjectEvidenceSection: () => <div data-testid="native-evidence" /> }));
vi.mock("@/components/project/project-resource-section", () => ({
  ProjectResourceSection: (props: any) => { mocks.resources(props); return <div data-testid="native-resources" />; },
  describeProjectResourceFailure: () => "资源加载失败",
  projectResourceHref: (_kind: string, id: string, project: string) => `/studio/board/${id}?projectId=${project}`,
}));

vi.mock("@/features/aidt/lib/live-aidt-stages", async original => ({...await original<typeof import("@/features/aidt/lib/live-aidt-stages")>(),readAidtStage:mocks.read,readAidtStageRevision:mocks.readRevision,saveAidtStage:mocks.save}));
const drafts=emptyAidtUiDrafts();
function saved(stageId:number,revision:number,fields:Record<string,string>={},sourceStageRevisions:{stageId:number;revision:number}[]=[]){return SharedStage.parse({projectId:"p",stageId,revision,content:{schemaVersion:1,draft:{...drafts[stageId]!,fields}},sourceStageRevisions,updatedBy:"student",updatedAt:"2026-11-16T00:00:00Z"});}
beforeEach(()=>{vi.clearAllMocks();mocks.search="history=1&tool=chat";mocks.list.mockResolvedValue({items:[]});});
it("actual S6 parent and shared-stage controller send the frozen S5 revision instead of its newer head",async()=>{
 const snapshot={schemaVersion:1,question:"旧轮被测问题",beforeTestBelief:"旧看法",verificationBasis:"学生记录",verificationLimits:"待真实测试",prototypeRef:"旧原型",sourceStageRevision:2};
 const fifth=saved(5,3,{verificationQuestion:"head新版问题，不应替换旧轮"}),sixth=saved(6,7,{questionSnapshot:JSON.stringify(snapshot)},[{stageId:5,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===5?fifth:id===6?sixth:null}));
 render(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);await screen.findByTestId("native-chat");await waitFor(()=>expect(mocks.chat.mock.calls.at(-1)![0].sharedContextReady).toBe(true));
 expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:5,revision:2},{stageNumber:6,revision:7}]);expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).not.toContainEqual({stageNumber:5,revision:3});
});
it("actual S3 parent preserves confirmed discovery-card provenance instead of a newer card head",async()=>{
 const second=saved(2,4),third=saved(3,6,{surpriseStatus:"found",priorBelief:"旧猜测",surprisingFinding:"新发现",surpriseCardIds:'["card-a"]',surpriseSourceRevision:"2",surpriseConfirmed:"true"},[{stageId:2,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===2?second:id===3?third:null}));
 render(<ProjectAidt projectId="p" sub="aidt-3" canWrite/>);await screen.findByTestId("native-chat");await waitFor(()=>expect(mocks.chat.mock.calls.at(-1)![0].sharedContextReady).toBe(true));expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:2,revision:2},{stageNumber:3,revision:6}]);
});
it("actual parent keeps loading and failed stage reads distinct from a confirmed empty result",async()=>{
 let fail!:(cause:Error)=>void;mocks.read.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));render(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);await screen.findByTestId("native-chat");expect(mocks.chat.mock.calls.at(-1)![0]).toMatchObject({sharedContextReady:false,sharedContextRefs:[]});await act(async()=>fail(new Error("offline")));await screen.findByTestId("aidt-shared-chat-alert");expect(mocks.chat.mock.calls.at(-1)![0]).toMatchObject({sharedContextReady:false,sharedContextRefs:[]});
});

it("UNSAVED S6: starting a new local test round must not select a different S5 alongside the still-saved old S6 round",async()=>{
 const oldSnapshot={schemaVersion:1,question:"已保存的旧轮问题",beforeTestBelief:"旧看法",verificationBasis:"",verificationLimits:"",prototypeRef:"旧原型V2",sourceStageRevision:2};
 const confirmedFifth=confirmAidtVerificationQuestion({...drafts[5]!,fields:{verificationQuestion:"新第五步问题V3",version:"新原型V3",beforeTestBelief:"新预期"}})!;
 const fifth=saved(5,3,confirmedFifth.fields),sixth=saved(6,7,{questionSnapshot:JSON.stringify(oldSnapshot),understandingChangeStatus:"insufficient",unresolvedQuestions:"旧轮证据仍不足",returnStep:"undecided",returnReason:"先请同伴支持",reflectionConfirmed:"true"},[{stageId:5,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===5?fifth:id===6?sixth:null}));
 mocks.search="history=1&tool=outcome"; const view=render(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);await waitFor(()=>expect(screen.getByRole("button",{name:"开始下一轮测试草稿"})).toBeEnabled());
 expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:5,revision:2},{stageNumber:6,revision:7}]);fireEvent.click(screen.getByRole("button",{name:"开始下一轮测试草稿"}));fireEvent.click(screen.getByRole("button",{name:"确认开始下一轮草稿"}));fireEvent.click(screen.getByRole("button",{name:"带入本轮验证问题"}));expect(screen.getByTestId("aidt-bound-question")).toHaveTextContent("新第五步问题V3");expect(screen.getByTestId("aidt-bound-question")).toHaveTextContent("第5步共享 V3");expect(mocks.save).not.toHaveBeenCalled();expect(JSON.parse(sixth.content.draft.fields.questionSnapshot!).sourceStageRevision).toBe(2);
 mocks.chat.mock.calls.at(-1)![0].hostPanel.onOpenChange(false); mocks.search=window.location.search.slice(1);view.rerender(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);
 expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:5,revision:2},{stageNumber:6,revision:7}]);
});
it("UNSAVED S3: reconfirming current cards locally must not mix their new version with the older saved reflection",async()=>{
 const cardId="3e7a8708-8e1a-4ee7-8223-cd79c5d50aed";
 const second=saved(2,4,{["interviewConfirmed:"+cardId]:"true",["interviewRecord:"+cardId]:JSON.stringify({id:cardId,version:1,code:"P01",topic:"教学夹具主题",topicRevision:1,goal:"理解经过",original:"说说最近一次经历？",adopted:"请说说最近一次实际经过？",guideConfirmed:true,consent:{notes:true,audio:false,photos:false,observedAt:"2026-11-22T07:39:00Z"}})});second.content.draft.discoveryCards=[{id:cardId,participantCode:"P01",headline:"新版发现卡",headlineKind:"student-summary",context:"教学夹具情境",quote:"教学夹具原文",sourceRef:"教学夹具来源",photoRef:""}];
 const third=saved(3,6,{surpriseStatus:"found",priorBelief:"旧判断",surprisingFinding:"旧发现",surpriseCardIds:JSON.stringify([cardId]),surpriseSourceRevision:"2",surpriseConfirmed:"true"},[{stageId:2,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===2?second:id===3?third:null}));
 mocks.search="history=1&tool=outcome"; const view=render(<ProjectAidt projectId="p" sub="aidt-3" canWrite/>);await waitFor(()=>expect(screen.getByTestId("aidt-surprise-confirm")).toBeEnabled());expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:2,revision:2},{stageNumber:3,revision:6}]);fireEvent.click(screen.getByTestId("aidt-surprise-confirm"));expect(screen.getByTestId("aidt-surprise-status")).toHaveTextContent("已由学生确认");expect(mocks.save).not.toHaveBeenCalled();expect(third.content.draft.fields.surpriseSourceRevision).toBe("2");
 mocks.chat.mock.calls.at(-1)![0].hostPanel.onOpenChange(false); mocks.search=window.location.search.slice(1);view.rerender(<ProjectAidt projectId="p" sub="aidt-3" canWrite/>);
 expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:2,revision:2},{stageNumber:3,revision:6}]);
});

function savedHmw(revision: number, id: string, text: string) {
  const evidenceRevision = 2;
  const cardIds = ["card-a"];
  const reviewed = { confirmed: true, archived: false, cardIds };
  const definition = { ...drafts[3]!, fields: { surpriseStatus: "none", surpriseConfirmed: "true" } };
  const withPersona = saveAidtDefinitionPersona(definition, {
    ...reviewed, id: "persona-a", name: "午休学生", situation: "食堂点单", behavior: "比较口味", need: "知道差异", limits: "有待复核",
  }, evidenceRevision);
  const withHmw = saveAidtDefinitionHmw(withPersona, {
    ...reviewed, id, text, personaIds: ["persona-a"], rationale: "小组已核对",
  }, evidenceRevision);
  const selected = chooseAidtDefinitionHmw(withHmw, id, new Set(cardIds));
  return saved(3, revision, selected.fields, [{ stageId: 2, revision: evidenceRevision }]);
}

it("uses an explicit HMW choice in the normal S4 creation dialog while an older legal link freezes its exact historical revision", async () => {
  const historicalQuestion = "我们如何帮助午休学生比较奶茶口味？";
  const latestQuestion = "我们如何让学生规划排队时间？";
  const historical = savedHmw(6, "hmw-taste", historicalQuestion);
  const latest = savedHmw(7, "hmw-queue", latestQuestion);
  let resolveHistorical!: (stage: typeof historical) => void;
  const historicalRead = new Promise<typeof historical>(resolve => { resolveHistorical = resolve; });
  mocks.read.mockImplementation(async (_projectId, stageId) => ({ stage: stageId === 3 ? latest : null }));
  mocks.readRevision.mockReturnValue(historicalRead);
  mocks.save.mockImplementation(async input => ({ stage: { ...saved(4, 1, {}, input.sourceStageRevisions), content: input.content } }));
  // Existing legal inbound links remain resolvable; S3 no longer needs to expose a separate CTA.
  mocks.search = "step=4&hmwRevision=6";
  render(<ProjectAidt projectId="p" sub="aidt-4" canWrite />);
  const rounds = within(await screen.findByRole("region", { name: "头脑风暴" }));
  expect(rounds.getByRole("button", { name: "新建卡片" })).toBeDisabled();
  expect(rounds.queryByText(latestQuestion)).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.readRevision).toHaveBeenLastCalledWith("p", 3, 6, "token-test", expect.any(AbortSignal)));
  expect(mocks.read).toHaveBeenCalledWith("p", 3, "token-test", expect.any(AbortSignal));
  await act(async () => resolveHistorical(historical));
  fireEvent.click(rounds.getByRole("button", { name: "新建卡片" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("combobox", { name: "HMW" })).toHaveValue("");
  expect(dialog.queryByRole("option", { name: latestQuestion })).not.toBeInTheDocument();
  expect(dialog.getByRole("option", { name: historicalQuestion })).toBeInTheDocument();
  fireEvent.change(dialog.getByRole("textbox", { name: "场次名称" }), { target: { value: "旧口味问题的独立发散轮" } });
  fireEvent.change(dialog.getByRole("combobox", { name: "发散方法" }), { target: { value: "free" } });
  expect(dialog.getByRole("button", { name: "开始头脑风暴" })).toBeDisabled(); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByRole("combobox", { name: "HMW" }), { target: { value: "hmw-taste" } });
  fireEvent.click(dialog.getByRole("button", { name: "开始头脑风暴" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const request = mocks.save.mock.calls[0]![0];
  const raw = Object.entries(request.content.draft.fields).find(([key]) => key.startsWith("ideaBrainstorm:"));
  expect(raw).toBeDefined();
  const session = JSON.parse(String(raw![1]));
  expect(session).toMatchObject({ title: "旧口味问题的独立发散轮", method: "free", source: { id: "hmw-taste", text: historicalQuestion, revision: 6 } });
  expect(JSON.stringify(session)).not.toContain(latestQuestion);
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining("entity=" + session.id)));
  expect(mocks.push.mock.calls.at(-1)?.[0]).toContain("hmwRevision=6");
});
