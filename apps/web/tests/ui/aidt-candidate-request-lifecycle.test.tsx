import * as React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useAidtCandidateRequest, type AidtCandidateController, type AidtCandidateTurn } from "@/features/aidt/lib/use-aidt-candidate-request";
import { useAidtDefinitionCandidateHost } from "@/features/aidt/lib/use-aidt-definition-candidate-host";
import type { AidtPersonaGenerationRequest } from "@/features/aidt/lib/aidt-persona-candidates";
import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import { AidtProblemCandidates } from "@/features/aidt/components/aidt-problem-candidates";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { readAidtDefinition, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";

const mocks = vi.hoisted(() => ({ session: { currentOrgId: "qa-org", userId: "qa-student", sessionToken: "qa-token" }, thread: vi.fn(), persisted: vi.fn(), api: vi.fn(), durableReply: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread }));
vi.mock("@/lib/copilotkit-v2-persisted-messages", () => ({ readAllPersistedMessages: mocks.persisted }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.api }));
vi.mock("@/features/aidt/lib/read-aidt-candidate-reply", () => ({ readAidtCandidateReply: mocks.durableReply }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let prompt: string;
let action: NonNullable<React.ContextType<typeof ChatHostTextActionContext>>;
function Wrapper({ children }: { children: React.ReactNode }) { return <ChatHostTextActionContext.Provider value={action}>{children}</ChatHostTextActionContext.Provider>; }
const initialMessages: AidtCandidateTurn[] = [{ id: "student-first", role: "user", content: "学生先表达自己的想法" }];
const sourceId="5f1ef77f-dd22-4389-88c7-e56ad43ef09a";
const sourceCard={id:sourceId,participantCode:"U01",headlineKind:"student-summary" as const,headline:"学生先比较口味",context:"合成教学夹具：午休点单经过",quote:"",sourceRef:"合成文字记录第2段",photoRef:""};
const sourceFields={["interviewConfirmed:"+sourceId]:"true",["interviewRecord:"+sourceId]:JSON.stringify({id:sourceId,version:1,code:"U01",topic:"午休点单",topicRevision:1,goal:"理解过程",original:"请说说上次经历？",adopted:"请回忆最近一次实际经历？",guideConfirmed:true,consent:{notes:true,audio:false,photos:false,observedAt:"2026-11-22T07:39:00Z"}})};
const sourceStage=SharedStage.parse({projectId:"qa-project",stageId:2,revision:2,content:{schemaVersion:1,draft:{fields:sourceFields,ideas:[],selectedIdeaId:"",discoveryCards:[sourceCard]}},sourceStageRevisions:[],updatedBy:"qa-student",updatedAt:"2026-11-22T07:39:00Z"});
const emptyDefinition=emptyAidtUiDrafts()[3]!;
const definitionDraft=saveAidtDefinitionPersona({...emptyDefinition,fields:{surpriseStatus:"none",surpriseConfirmed:"true"}},{id:"qa-persona",confirmed:true,archived:false,cardIds:[sourceId],name:"午休点单学生",situation:"食堂",behavior:"比较口味",need:"区分差异",limits:"合成软件夹具，不是真实访谈"},2);
const definitionStage=SharedStage.parse({projectId:"qa-project",stageId:3,revision:3,content:{schemaVersion:1,draft:definitionDraft},sourceStageRevisions:[{stageId:2,revision:2}],updatedBy:"qa-student",updatedAt:"2026-11-22T07:39:00Z"});
const sourcePersona=readAidtDefinition(definitionStage.content.draft.fields).personas[0]!;
function expectFreshSourceReads(perStage:number){
  expect(mocks.api).toHaveBeenCalledTimes(perStage*2);
  for(const stageId of [2,3])expect(mocks.api.mock.calls.filter(([url])=>url===`/projects/qa-project/aidt/stages/${stageId}`)).toHaveLength(perStage);
  for(const [,options] of mocks.api.mock.calls)expect(options).toMatchObject({method:"GET",sessionToken:"qa-token"});
}
function base() { return { kind: "problem" as const, projectId: "qa-project", entityId: "qa-entity", sourceKey: "source-v1", messages: initialMessages,
  loading: false, running: false, enabled: true, instruction: "请整理候选", parseReply: (value: string) => value.split("；"), readCurrentSource: async () => "source-v1" }; }
function replyTurns(): AidtCandidateTurn[] { return [...initialMessages, { id: "native-human", role: "user", content: prompt }, { id: "native-reply", role: "assistant", content: "候选甲；候选乙" }]; }
async function startCandidate(controller: AidtCandidateController<string>) { await act(async () => controller.start()); }
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(mocks.session, { currentOrgId: "qa-org", userId: "qa-student", sessionToken: "qa-token" }); prompt = "";
  action = { projectId: "qa-project", threadId: "qa-thread", available: true, running: false, occupied: false, failed: false, sendText: vi.fn(async text => { prompt = text; return true; }) };
  mocks.durableReply.mockResolvedValue({ messageId: "durable-reply", runId: "native-run" });
  mocks.thread.mockResolvedValue({ thread: { id: "qa-thread", projectId: "qa-project", visibilityScope: "plenary", groupId: null, archived: false }, capabilities: ["composer.send"] });
  mocks.api.mockImplementation(async(url:string)=>{
    if(url==="/projects/qa-project/aidt/stages/2")return {stage:sourceStage};
    if(url==="/projects/qa-project/aidt/stages/3")return {stage:definitionStage};
    throw new Error("Unexpected source request in candidate lifecycle QA");
  });
});
afterEach(cleanup);

it("does not adopt or persist a generated reply until the student explicitly selects and adopts", async () => {
  let options = base(); const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  const adopt = vi.fn(); expect(action.sendText).not.toHaveBeenCalled();
  await startCandidate(result.current); options = { ...options, messages: replyTurns() }; rerender();
  await waitFor(() => expect(result.current.candidates).toEqual(["候选甲", "候选乙"]));
  expect(result.current.selectedIndex).toBeNull(); expect(adopt).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.durableReply).not.toHaveBeenCalled();
  await act(async () => { expect(await result.current.adopt(adopt)).toBe(false); }); expect(adopt).not.toHaveBeenCalled();
  act(() => result.current.choose(1)); await act(async () => { expect(await result.current.adopt(adopt)).toBe(true); });
  expect(adopt).toHaveBeenCalledOnce(); expect(adopt).toHaveBeenCalledWith("候选乙", expect.objectContaining({ projectId: "qa-project", entityId: "qa-entity", threadId: "qa-thread", messageId: "durable-reply", sourceKey: "source-v1" }));
  expect(mocks.api).not.toHaveBeenCalled(); expect(result.current.candidates).toEqual([]);
  expect(mocks.durableReply).toHaveBeenCalledOnce(); expect(mocks.durableReply).toHaveBeenCalledWith(expect.objectContaining({ projectId: "qa-project", threadId: "qa-thread", prompt, replyText: "候选甲；候选乙", sessionToken: "qa-token" }));
});

it("ignores a late source check after cancellation without sending anything", async () => {
  const check = deferred<string>(); const options = { ...base(), readCurrentSource: () => check.promise };
  const { result } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  let started!: Promise<void>; act(() => { started = result.current.start(); });
  act(() => result.current.cancel()); await act(async () => { check.resolve("source-v1"); await started; });
  expect(action.sendText).not.toHaveBeenCalled(); expect(result.current.candidates).toEqual([]); expect(result.current.active).toBe(false);
});

it.each(["project", "actor", "source"])("rejects late candidate replies after %s changes", async change => {
  let options = base(); const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  await startCandidate(result.current); const oldTurns = replyTurns();
  if (change === "project") { action = { ...action, projectId: "other-project", threadId: "other-thread" }; options = { ...options, projectId: "other-project" }; }
  if (change === "actor") mocks.session.userId = "another-student";
  if (change === "source") options = { ...options, sourceKey: "source-v2" };
  options = { ...options, messages: oldTurns }; rerender();
  expect(result.current.candidates).toEqual([]); const adopt = vi.fn(); await act(async () => { expect(await result.current.adopt(adopt)).toBe(false); }); expect(adopt).not.toHaveBeenCalled();
});

it("does not apply after a source revocation that happens during the explicit adoption check", async () => {
  let revoked = false; const check = deferred<string>();
  let options = { ...base(), readCurrentSource: () => revoked ? check.promise : Promise.resolve("source-v1") };
  const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  await startCandidate(result.current); options = { ...options, messages: replyTurns() }; rerender();
  await waitFor(() => expect(result.current.candidates).toHaveLength(2)); act(() => result.current.choose(0));
  revoked = true; const adopt = vi.fn(); let work!: Promise<boolean>; act(() => { work = result.current.adopt(adopt); });
  await act(async () => { check.resolve("revoked-source"); expect(await work).toBe(false); });
  expect(adopt).not.toHaveBeenCalled(); expect(result.current.candidates).toEqual([]);
});

it("rejects candidates after a later student turn rather than applying the previous reply", async () => {
  let options = base(); const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  await startCandidate(result.current); options = { ...options, messages: [...replyTurns(), { id: "new-user", role: "user", content: "学生有新的取舍" }] }; rerender();
  expect(result.current.candidates).toEqual([]); expect(result.current.status).toContain("新的学生输入");
});

const request: AidtPersonaGenerationRequest = { kind: "hmw", source: { orgId: "qa-org", projectId: "qa-project", revision: 2, definitionRevision: 3, cardIds: [sourceId] },cards:[sourceCard],personaIds:[sourcePersona.id], prompt: AIDT_CANDIDATE_ACTIONS.hmw + "\n学生请求可审阅HMW候选\n"+JSON.stringify(sourcePersona) };
function hostOptions() { return { projectId: "qa-project", revision: 2, definitionRevision: 3, canWrite: true, messages: initialMessages, loading: false, running: false }; }
function durable(runId = "native-run") { return { pendingRunId: null, messages: [{ id: "durable-human", role: "user", content: prompt, agentRunId: "native-run" }, { id: "durable-reply", role: "assistant", content: "已落库的候选", agentRunId: runId }] }; }

it("S3 returns the same native run's durable messages instead of the transient visible assistant", async () => {
  let options = hostOptions(); const { result, rerender } = renderHook(() => useAidtDefinitionCandidateHost(options), { wrapper: Wrapper });
  let work!: ReturnType<typeof result.current.generate>; act(() => { work = result.current.generate(request); });
  await waitFor(()=>expect(action.sendText).toHaveBeenCalledOnce()); mocks.persisted.mockImplementation(async () => durable());
  options = { ...options, messages: replyTurns() }; rerender();
  await expect(work).resolves.toEqual({ threadId: "qa-thread", messages: [expect.objectContaining({ id: "durable-reply", content: "已落库的候选", agentRunId: "native-run" })],syntheticCardIds:[] });
  expect(mocks.thread).toHaveBeenCalledWith("qa-thread", "qa-project", "qa-token"); expectFreshSourceReads(2);
});

it("S3 refuses a persisted assistant from another run even if the visible reply looks valid", async () => {
  let options = hostOptions(); const { result, rerender } = renderHook(() => useAidtDefinitionCandidateHost(options), { wrapper: Wrapper });
  let work!: ReturnType<typeof result.current.generate>; act(() => { work = result.current.generate(request); }); const checked = expect(work).rejects.toThrow("尚未读回");
  await waitFor(()=>expect(action.sendText).toHaveBeenCalledOnce()); mocks.persisted.mockImplementation(async () => durable("different-run"));
  options = { ...options, messages: replyTurns() }; rerender(); await checked; expectFreshSourceReads(1);
});

it("S3 aborts a pending source read across actor switches and cannot resolve stale candidates", async () => {
  const read = deferred<ReturnType<typeof durable>>(); mocks.persisted.mockReturnValue(read.promise);
  let options = hostOptions(); const { result, rerender } = renderHook(() => useAidtDefinitionCandidateHost(options), { wrapper: Wrapper });
  let work!: ReturnType<typeof result.current.generate>; act(() => { work = result.current.generate(request); }); const checked = expect(work).rejects.toThrow("来源或对话已变化");
  await waitFor(()=>expect(action.sendText).toHaveBeenCalledOnce()); options = { ...options, messages: replyTurns() }; rerender(); await waitFor(() => expect(mocks.persisted).toHaveBeenCalledOnce());
  mocks.session.userId = "another-student"; rerender(); await checked; await act(async () => { read.resolve(durable()); await Promise.resolve(); });
  expectFreshSourceReads(1);
});


it("keeps a streaming candidate out of the draft when its durable run cannot be verified", async () => {
  mocks.durableReply.mockRejectedValueOnce(new Error("AIDT_CANDIDATE_RUN_INCOMPLETE"));
  let options = base(); const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  await startCandidate(result.current); options = { ...options, messages: replyTurns() }; rerender();
  await waitFor(() => expect(result.current.candidates).toHaveLength(2)); act(() => result.current.choose(0));
  const adopt = vi.fn(); await act(async () => { expect(await result.current.adopt(adopt)).toBe(false); });
  expect(adopt).not.toHaveBeenCalled(); expect(result.current.candidates).toHaveLength(2);
});

it("ignores a successful durable read that completes after the actor changes", async () => {
  const reading = deferred<{ messageId: string; runId: string }>(); mocks.durableReply.mockReturnValueOnce(reading.promise);
  let options = base(); const { result, rerender } = renderHook(() => useAidtCandidateRequest(options), { wrapper: Wrapper });
  await startCandidate(result.current); options = { ...options, messages: replyTurns() }; rerender();
  await waitFor(() => expect(result.current.candidates).toHaveLength(2)); act(() => result.current.choose(0));
  const adopt = vi.fn(); let work!: Promise<boolean>; act(() => { work = result.current.adopt(adopt); });
  await waitFor(() => expect(mocks.durableReply).toHaveBeenCalledOnce());
  mocks.session.userId = "different-actor"; rerender();
  await act(async () => { reading.resolve({ messageId: "durable-reply", runId: "native-run" }); expect(await work).toBe(false); });
  expect(adopt).not.toHaveBeenCalled();
});

it("requests only missing problem reflection as editable chat suggestions", async () => {
  const stage = SharedStage.parse({
    ...definitionStage,
    stageId: 1,
    sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: {
      fields: {
        ["problemEntity:" + sourceId]: JSON.stringify({ id: sourceId, title: "午休点单", archived: false }),
        ["problemDraft:" + sourceId]: JSON.stringify({ initial: "午休点单" }),
      },
      ideas: [],
      selectedIdeaId: "",
    } },
  });
  const props = { stage, projectId: stage.projectId, entityId: sourceId, sessionToken: "qa-token", loading: false, running: false, onRefresh: vi.fn() };
  const view = render(<Wrapper><AidtProblemCandidates {...props} messages={[]} /></Wrapper>);
  const button = screen.getByRole("button", { name: "AI 提供命题候选" });
  expect(button).toBeDisabled();
  view.rerender(<Wrapper><AidtProblemCandidates {...props} messages={initialMessages} /></Wrapper>);
  expect(button).toBeEnabled();
  await act(async () => fireEvent.click(button));
  expect(action.sendText).toHaveBeenCalledTimes(1);
  expect(prompt).toContain(AIDT_CANDIDATE_ACTIONS.problem + "\n");
  expect(prompt).toContain("选题理由、问题来源、来源描述");
  expect(prompt).not.toContain("补充这些缺项：原始命题");
  expect(prompt).toContain("待验证猜测");
  expect(mocks.api).not.toHaveBeenCalled();
});
