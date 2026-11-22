import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { AidtInterviewDiscoveryCandidates } from "@/features/aidt/components/aidt-interview-discovery-candidates";
import { AidtInterviewSaveState } from "@/features/aidt/components/aidt-interview-save-state";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtInterviewMaterialKey, getAidtInterviewFinding, readAidtInterviews, writeAidtInterview, writeAidtInterviewFinding, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";

const mocks = vi.hoisted(() => ({ read: vi.fn(), writes: vi.fn(), auto: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "qa-org", userId: "qa-student", sessionToken: "qa-session" } }) }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read }));
vi.mock("@/features/aidt/lib/read-aidt-candidate-reply", () => ({ readAidtCandidateReply: vi.fn(async () => ({ messageId: "persisted-qa-reply", runId: "persisted-qa-run" })) }));
const id = "15c7b5e2-9d0e-4b10-bc47-000000000001";
const person: AidtInterview = { id, version: 1, code: "U01", topicRevision: 1, topic: "午休选饮料", goal: "了解实际选择", original: "你上次怎么选？", adopted: "上次选择经过？", guideConfirmed: true,
  consent: { notes: true, audio: false, photos: false, observedAt: "2026-11-22T01:00:00.000Z" } };
let server: AidtUiStageDraft;
function initial() {
  const key = aidtInterviewMaterialKey(id, "source");
  let draft = writeAidtInterview(emptyAidtUiDrafts()[2]!, person);
  draft = writeAidtInterviewFinding(draft, person, { headline: "先看菜单", headlineKind: "student-summary", context: "午休比较饮品。", quote: "我先看口味", sourceRef: "U01.txt · 00:01" });
  draft.fields[key] = JSON.stringify({ projectId: "qa", artifactId: "text-u01", runId: "run", versionId: "v1", name: "U01.txt", mime: "text/plain", sha256: "a".repeat(64), bytes: 22 });
  draft.fields["interviewTranscript:" + id] = JSON.stringify({ sourceKey: key, locator: "00:01", text: "我先看口味", checked: true });
  return draft;
}
function Host() {
  const [draft, setDraft] = React.useState(server);
  const [pending, setPending] = React.useState(false);
  const [messages, setMessages] = React.useState([{ id: "student-initial", role: "user", content: "我发现她先看口味，再考虑尝新" }]);
  const current = readAidtInterviews(draft.fields).find(row => row.id === id)!;
  const saveDraft = async (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => {
    mocks.writes(); server = mutate(server); setDraft(server); setPending(false); return true;
  };
  const controller = { canSave: true, matchesServer: !pending, write: { phase: "idle" }, saveCurrent: async () => { mocks.auto(); server = draft; setPending(false); return true; } } as unknown as React.ComponentProps<typeof AidtInterviewSaveState>["controller"];
  const action = { projectId: "qa", threadId: "qa-interview-thread", available: true, occupied: false, running: false, failed: false,
    sendText: async (prompt: string) => { setMessages(old => [...old, { id: "candidate-request", role: "user", content: prompt }, { id: "candidate-reply", role: "assistant", content: "候选1：她先确认熟悉口味，再考虑新品。\n候选2：尝新和避免失望之间仍有取舍。" }]); return true; } };
  return <ChatHostTextActionContext.Provider value={action}>
    <AidtInterviewDiscoveryCandidates projectId="qa" interview={current} draft={draft} messages={messages} loading={false} running={false} saveDraft={saveDraft} />
    <AidtInterviewSaveState controller={controller} editPending={pending} signature={JSON.stringify(draft)} />
    <button onClick={() => { setDraft(old => writeAidtInterviewFinding(old, current, { context: "正常人工编辑" })); setPending(true); }}>正常人工编辑</button>
  </ChatHostTextActionContext.Provider>;
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); }
async function adopt() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 归纳发现" })); });
  fireEvent.click(screen.getByRole("radio", { name: "她先确认熟悉口味，再考虑新品。" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /替换当前/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "填入草稿" })); });
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); server = initial(); mocks.read.mockImplementation(async () => ({ stage: { content: { draft: server } } })); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps candidate selection/edit/cancel outside the real 350ms automatic group-save path", async () => {
  render(<Host />); const before = JSON.stringify(server);
  await adopt(); await tick();
  fireEvent.change(screen.getByRole("textbox", { name: "AI 辅助的一句发现" }), { target: { value: "学生重新写的发现" } }); await tick();
  expect(JSON.stringify(server)).toBe(before); expect(mocks.writes).not.toHaveBeenCalled(); expect(mocks.auto).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保留原卡片，放弃此草稿" })); await tick();
  expect(JSON.stringify(server)).toBe(before); expect(mocks.writes).not.toHaveBeenCalled();
  // The actual existing automatic-save component is active, rather than mocked away.
  fireEvent.click(screen.getByRole("button", { name: "正常人工编辑" })); await tick(); expect(mocks.auto).toHaveBeenCalledOnce();
});

it("saves only explicit edited adoption, preserves original quotation/context, and leaves confirmation unset", async () => {
  const view = render(<Host />); await adopt();
  fireEvent.change(screen.getByRole("textbox", { name: "AI 辅助的一句发现" }), { target: { value: "学生核对后的概括" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存发现草稿" })); }); await tick();
  expect(mocks.writes).toHaveBeenCalledOnce(); expect(mocks.auto).not.toHaveBeenCalled();
  expect(getAidtInterviewFinding(server, person)).toMatchObject({ headline: "学生核对后的概括", headlineKind: "student-summary", quote: "我先看口味", context: "午休比较饮品。" });
  expect(server.fields["interviewConfirmed:" + id]).toBeFalsy();
  view.unmount(); render(<Host />); expect(getAidtInterviewFinding(server, person).headline).toBe("学生核对后的概括");
});

it("rechecks authorization before explicit save and preserves the local expression if notes consent was revoked", async () => {
  render(<Host />); await adopt();
  server = writeAidtInterview(server, { ...person, consent: { ...person.consent!, notes: false } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存发现草稿" })); }); await tick();
  expect(mocks.writes).not.toHaveBeenCalled(); expect(mocks.auto).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "AI 辅助的一句发现" })).toHaveValue("她先确认熟悉口味，再考虑新品。");
  expect(getAidtInterviewFinding(server, person).headline).toBe("先看菜单");
});
