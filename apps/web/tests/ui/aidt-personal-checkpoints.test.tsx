import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtPersonalCheckpointPanel } from "@/features/aidt/components/aidt-personal-checkpoint-panel";
import { useAidtPersonalCheckpoints, aidtCheckpointKey } from "@/features/aidt/lib/use-aidt-personal-checkpoints";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AidtPersonalCheckpointError, type AidtPersonalStageCheckpoint, type AidtPersonalStageLoadResult } from "@/features/aidt/lib/aidt-stage-persistence";
import type { ListMessagesOut } from "@/lib/live-chat";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), messages: vi.fn(), share: vi.fn(), createMessage: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-stage-persistence", async () => ({ ...await vi.importActual<typeof import("@/features/aidt/lib/aidt-stage-persistence")>("@/features/aidt/lib/aidt-stage-persistence"), loadAidtPersonalStageCheckpoints: mocks.load, saveAidtPersonalStageCheckpoint: mocks.save }));
vi.mock("@/lib/live-chat", () => ({ listMessages: mocks.messages, createMessage: mocks.createMessage, getThread: vi.fn(), getThreadArtifactSource: vi.fn(), landAsArtifact: vi.fn(), listThreadArtifacts: vi.fn() }));

function stageDraft(text = "学生自己的问题", stageNumber = 1): AidtUiStageDraft { return { ...emptyAidtUiDrafts()[stageNumber]!, fields: { [stageNumber === 2 ? "guide" : "initial"]: text } }; }
function checkpoint(id = "artifact-1", text = "服务器里的学生问题"): AidtPersonalStageCheckpoint {
  return { artifactId: id, immutableRevision: `revision-${id}`, threadId: "thread-1", messageId: "human-1", stageId: 1, draft: stageDraft(text), savedAt: "2026-11-15T01:00:00.000Z", savedBy: "student-a", operationId: `operation-${id}`, parent: null, visibility: "personal-draft" };
}
function message(id = "human-1", authorKind: "human" | "agent" = "human"): ListMessagesOut["messages"][number] {
  return { id, authorKind, authorId: "student-a", agentId: null, text: authorKind === "human" ? `学生消息 ${id}` : "AI建议不是学生输入", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-11-15T00:00:00.000Z" };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Harness({ actor = "student-a", life = "lifecycle-a", token = "token-a", threadId = "thread-1", canWrite = true, initial = stageDraft(), stageNumber = 1, enabled = true }: { actor?: string; life?: string; token?: string; threadId?: string | null; canWrite?: boolean; initial?: AidtUiStageDraft; stageNumber?: number; enabled?: boolean }) {
  const [draftState, setDraft] = React.useState({ life, draft: initial });
  const draft = draftState.life === life ? draftState.draft : stageDraft("", stageNumber);
  React.useEffect(() => { setDraft(previous => previous.life === life ? previous : { life, draft: stageDraft("", stageNumber) }); }, [life, stageNumber]);
  const controller = useAidtPersonalCheckpoints({ enabled, lifecycleKey: life, scope: { orgId: "org", userId: actor, projectId: "project", sessionToken: token }, threadId, stageId: stageNumber, draft, canWrite, onRestore: restored => setDraft({ life, draft: restored }) });
  const [shared, setShared] = React.useState<string | undefined>();
  React.useEffect(() => { setShared(undefined); }, [controller.key]);
  return <><label>学生本页内容<input aria-label="学生本页内容" value={draft.fields[stageNumber === 2 ? "guide" : "initial"] ?? ""} disabled={!canWrite} onChange={event => setDraft({ life, draft: { ...draft, fields: { ...draft.fields, [stageNumber === 2 ? "guide" : "initial"]: event.currentTarget.value } } })} /></label><output data-testid="current-full-draft">{JSON.stringify(draft)}</output><AidtPersonalCheckpointPanel key={controller.key} stageNumber={stageNumber} controller={controller} readOnly={!canWrite} sharedCheckpointKey={shared} onShare={selected => { mocks.share(selected); setShared(selected ? aidtCheckpointKey(selected) : undefined); }} /></>;
}
async function expand() { fireEvent.click(screen.getByTestId("aidt-checkpoint-summary")); await screen.findByTestId("aidt-checkpoint-source"); }
async function selectSource() { await waitFor(() => expect(screen.getByRole("option", { name: /学生消息 human-1/ })).toBeInTheDocument()); fireEvent.change(screen.getByTestId("aidt-checkpoint-source"), { target: { value: "human-1" } }); }
function chooseCheckpoint(value: AidtPersonalStageCheckpoint) { fireEvent.change(screen.getByTestId("aidt-checkpoint-select"), { target: { value: aidtCheckpointKey(value) } }); }

beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockReset(); mocks.save.mockReset(); mocks.messages.mockReset();
  mocks.load.mockResolvedValue({ checkpoints: [], heads: [] });
  mocks.messages.mockResolvedValue({ messages: [message(), message("agent-1", "agent")], nextCursor: null });
  mocks.save.mockImplementation(async (_scope, input: { draft: AidtUiStageDraft }) => ({ ...checkpoint(), draft: input.draft }));
});
afterEach(() => { expect(mocks.createMessage).not.toHaveBeenCalled(); });

it("does not save, restore or share a private checkpoint automatically and requires an actual human source", async () => {
  render(<Harness />); await expand(); await waitFor(() => expect(screen.getByTestId("aidt-checkpoint-save")).toBeDisabled());
  expect(screen.getByTestId("aidt-checkpoint-source")).toHaveValue(""); expect(screen.queryByRole("option", { name: /AI建议/ })).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  await selectSource(); expect(screen.getByTestId("aidt-checkpoint-save")).toBeEnabled();
  expect(screen.getByText(/仅自己可见，小组未同步/)).toBeVisible();
});
it("waits for the real save/readback receipt, then labels it personal instead of group-confirmed", async () => {
  const pending = deferred<AidtPersonalStageCheckpoint>(); mocks.save.mockReturnValue(pending.promise);
  render(<Harness />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save"));
  expect(screen.getByTestId("aidt-checkpoint-save")).toBeDisabled(); expect(screen.queryByTestId("aidt-checkpoint-receipt")).toBeNull();
  await act(async () => pending.resolve(checkpoint()));
  expect(await screen.findByTestId("aidt-checkpoint-receipt")).toHaveTextContent("artifact-1");
  expect(screen.getByTestId("aidt-checkpoint-receipt")).toHaveTextContent("仅自己可见，小组未同步");
  expect(mocks.share).not.toHaveBeenCalled();
});
it("keeps edits made during a save and never calls the newer text saved", async () => {
  const pending = deferred<AidtPersonalStageCheckpoint>(); mocks.save.mockReturnValue(pending.promise);
  render(<Harness />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save"));
  const request = mocks.save.mock.calls[0]![1] as { draft: AidtUiStageDraft };
  fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "请求进行中继续修改" } });
  expect(request.draft.fields.initial).toBe("学生自己的问题");
  await act(async () => pending.resolve({ ...checkpoint(), draft: request.draft }));
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("请求进行中继续修改");
  expect(await screen.findByTestId("aidt-checkpoint-receipt")).toHaveTextContent("当前新修改尚未保存");
});
it("preserves the whole draft and reuses the same operation ID for an uncertain save retry", async () => {
  mocks.save.mockRejectedValueOnce(new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED", "保存回读未确认"));
  render(<Harness />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save"));
  await screen.findByTestId("aidt-checkpoint-save-error"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题");
  fireEvent.click(screen.getByTestId("aidt-checkpoint-save")); await screen.findByTestId("aidt-checkpoint-receipt");
  expect(mocks.save.mock.calls[1]![1].operationId).toBe(mocks.save.mock.calls[0]![1].operationId);
});
it("a dependency failure stays an error and blocks an uninformed save until reread", async () => {
  mocks.load.mockRejectedValueOnce(new Error("offline")); render(<Harness />); fireEvent.click(screen.getByTestId("aidt-checkpoint-summary"));
  await screen.findByTestId("aidt-checkpoint-load-error"); expect(screen.queryByTestId("aidt-checkpoint-empty")).toBeNull(); expect(mocks.messages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("aidt-checkpoint-load-retry")); await screen.findByTestId("aidt-checkpoint-empty"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题");
});
it("a reread after reopening restores only after an explicit local-replacement confirmation", async () => {
  const saved = checkpoint(); mocks.load.mockResolvedValue({ checkpoints: [saved], heads: [saved] });
  render(<Harness />); await expand(); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题");
  chooseCheckpoint(saved); fireEvent.click(screen.getByTestId("aidt-checkpoint-restore")); await screen.findByTestId("aidt-checkpoint-restore-confirm");
  fireEvent.click(screen.getByTestId("aidt-checkpoint-restore-cancel")); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题");
  fireEvent.click(screen.getByTestId("aidt-checkpoint-restore")); fireEvent.click(screen.getByTestId("aidt-checkpoint-restore-confirm-apply"));
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器里的学生问题"); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.share).toHaveBeenCalledTimes(1); expect(mocks.share).toHaveBeenCalledWith(null);
});
it("restores an empty form without inventing group synchronization", async () => {
  const saved = checkpoint(); mocks.load.mockResolvedValue({ checkpoints: [saved], heads: [saved] });
  render(<Harness initial={stageDraft("")} />); await expand(); chooseCheckpoint(saved); fireEvent.click(screen.getByTestId("aidt-checkpoint-restore"));
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("服务器里的学生问题"); expect(screen.getByTestId("aidt-checkpoint-restore-notice")).toHaveTextContent("尚未同步给小组");
});
it("blocks unsupported fork merging while keeping every branch available for recovery", async () => {
  const first = checkpoint("branch-a"), second = checkpoint("branch-b"); mocks.load.mockResolvedValue({ checkpoints: [first, second], heads: [first, second] });
  render(<Harness />); await expand(); await selectSource(); await screen.findByTestId("aidt-checkpoint-forks");
  expect(screen.getByTestId("aidt-checkpoint-save")).toBeDisabled(); chooseCheckpoint(second);
  expect(screen.getByTestId("aidt-checkpoint-preview")).toHaveTextContent("branch-b"); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not silently overwrite after the server reports a newer head", async () => {
  const latest = checkpoint("new-head"); mocks.save.mockRejectedValueOnce(new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_CONFLICT", "基准已变化", [latest]));
  render(<Harness />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save"));
  await screen.findByTestId("aidt-checkpoint-conflict"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题"); expect(screen.getByTestId("aidt-checkpoint-save")).toBeDisabled();
  fireEvent.change(screen.getByTestId("aidt-checkpoint-base"), { target: { value: aidtCheckpointKey(latest) } });
  fireEvent.click(screen.getByTestId("aidt-checkpoint-save")); await screen.findByTestId("aidt-checkpoint-receipt");
  expect(mocks.save.mock.calls[1]![1].expectedHead).toEqual({ artifactId: latest.artifactId, immutableRevision: latest.immutableRevision });
});
it("only discloses private content to group AI after the explicit checkbox, and changing the selection withdraws the pending choice", async () => {
  const first = checkpoint(), second = checkpoint("other"); mocks.load.mockResolvedValue({ checkpoints: [first, second], heads: [second] });
  render(<Harness />); await expand(); chooseCheckpoint(first); expect(mocks.share).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByTestId("aidt-checkpoint-share")); expect(mocks.share).toHaveBeenLastCalledWith(first);
  chooseCheckpoint(second); expect(mocks.share).toHaveBeenLastCalledWith(null); expect(screen.getByTestId("aidt-checkpoint-share")).not.toBeChecked();
});
it("ignores a late old-actor save after A to B to A, and retains the returning actor's new text", async () => {
  const pending = deferred<AidtPersonalStageCheckpoint>(); mocks.save.mockReturnValue(pending.promise);
  const { rerender } = render(<Harness />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save"));
  rerender(<Harness actor="student-b" life="lifecycle-b" />); rerender(<Harness actor="student-a" life="lifecycle-a-returned" />);
  fireEvent.change(screen.getByLabelText("学生本页内容"), { target: { value: "A回来后新输入" } });
  await act(async () => pending.resolve(checkpoint()));
  expect(screen.getByLabelText("学生本页内容")).toHaveValue("A回来后新输入"); expect(screen.queryByTestId("aidt-checkpoint-receipt")).toBeNull();
});
it("an old read cannot restore another actor's checkpoint after a scope change", async () => {
  const old = deferred<AidtPersonalStageLoadResult>(); mocks.load.mockReturnValueOnce(old.promise);
  const { rerender } = render(<Harness />); rerender(<Harness actor="student-b" life="life-b" />);
  await act(async () => old.resolve({ checkpoints: [checkpoint("old-a")], heads: [checkpoint("old-a")] }));
  fireEvent.click(screen.getByTestId("aidt-checkpoint-summary")); await screen.findByTestId("aidt-checkpoint-empty"); expect(screen.queryByText(/old-a/)).toBeNull();
});
it("read-only views can inspect personal records but cannot save, restore or disclose them", async () => {
  const saved = checkpoint(); mocks.load.mockResolvedValue({ checkpoints: [saved], heads: [saved] });
  render(<Harness canWrite={false} />); fireEvent.click(screen.getByTestId("aidt-checkpoint-summary")); await screen.findByTestId("aidt-checkpoint-readonly"); chooseCheckpoint(saved);
  expect(screen.getByTestId("aidt-checkpoint-restore")).toBeDisabled(); expect(screen.getByTestId("aidt-checkpoint-share")).toBeDisabled(); expect(screen.queryByTestId("aidt-checkpoint-save")).toBeNull(); expect(mocks.messages).not.toHaveBeenCalled();
});
it("does not load or write without an enabled module and resolved thread", async () => {
  const { rerender } = render(<Harness enabled={false} />); fireEvent.click(screen.getByTestId("aidt-checkpoint-summary")); expect(screen.getByTestId("aidt-checkpoint-waiting")).toBeVisible();
  rerender(<Harness threadId={null} />); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("paginates real source messages, preserving the current form when the next page fails", async () => {
  mocks.messages.mockResolvedValueOnce({ messages: [message()], nextCursor: "cursor-next" }).mockRejectedValueOnce(new Error("offline"));
  render(<Harness />); await expand(); await screen.findByTestId("aidt-checkpoint-more-sources"); fireEvent.click(screen.getByTestId("aidt-checkpoint-more-sources"));
  await screen.findByTestId("aidt-checkpoint-source-error"); expect(screen.getByLabelText("学生本页内容")).toHaveValue("学生自己的问题");
  expect(mocks.messages).toHaveBeenLastCalledWith("thread-1", { cursor: "cursor-next", limit: 30 }, "token-a");
});
it("carries discovery cards and all unedited stage fields through snapshot save and restore", async () => {
  const draft = stageDraft("学生访谈原稿", 2); draft.discoveryCards = [{ id: "card-1", participantCode: "A", headline: "学生概括", headlineKind: "student-summary", context: "校园", quote: "真实引文需核对", sourceRef: "已有材料引用", photoRef: "已有照片引用" }];
  render(<Harness initial={draft} stageNumber={2} />); await expand(); await selectSource(); fireEvent.click(screen.getByTestId("aidt-checkpoint-save")); await screen.findByTestId("aidt-checkpoint-receipt");
  expect(mocks.save.mock.calls[0]![1].draft.discoveryCards).toEqual(draft.discoveryCards); expect(screen.getByTestId("current-full-draft")).toHaveTextContent("已有照片引用");
});
