import { beforeEach, expect, it, vi } from "vitest";
import { readAidtCandidateReply } from "@/features/aidt/lib/read-aidt-candidate-reply";
const mocks = vi.hoisted(() => ({ thread: vi.fn(), messages: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread }));
vi.mock("@/lib/copilotkit-v2-persisted-messages", () => ({ readAllPersistedMessages: mocks.messages }));
vi.mock("@/lib/chat-workbench/read-chat-agent-run", () => ({ readChatAgentRun: mocks.run }));
const input = () => ({ projectId: "project", threadId: "thread", prompt: "精确本轮学生请求", replyText: "已审阅候选文本", sessionToken: "token", signal: new AbortController().signal });
const durable = () => ({ pendingRunId: null, messages: [
  { id: "human", role: "user", content: "精确本轮学生请求", agentRunId: "run" },
  { id: "durable-assistant", role: "assistant", content: "已审阅候选文本", agentRunId: "run" },
] });
const run = () => ({ runId: "run", threadId: "thread", inputMessageId: "human", status: "succeeded", resultMessageId: "durable-assistant" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.thread.mockResolvedValue({ thread: { id: "thread", projectId: "project", groupId: null, visibilityScope: "plenary", archived: false } });
  mocks.messages.mockResolvedValue(durable()); mocks.run.mockResolvedValue(run());
});
it("reads the durable message ID through the real API projection shapes", async () => {
  await expect(readAidtCandidateReply(input())).resolves.toEqual({ messageId: "durable-assistant", runId: "run" });
  expect(mocks.thread).toHaveBeenCalledWith("thread", "project", "token"); expect(mocks.messages).toHaveBeenCalledWith("thread", "token");
  expect(mocks.run).toHaveBeenCalledWith("run", "token", expect.any(AbortSignal));
});
it.each([
  { id: "other" }, { projectId: "other" }, { groupId: "separate-group" }, { visibilityScope: "personal" }, { archived: true },
])("rejects an unrelated or inaccessible thread scope %j", async change => {
  mocks.thread.mockResolvedValue({ thread: { id: "thread", projectId: "project", groupId: null, visibilityScope: "plenary", archived: false, ...change } });
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_THREAD_CHANGED"); expect(mocks.messages).not.toHaveBeenCalled();
});
it.each(["queued", "running", "failed", "cancelled"])("rejects a %s run rather than promoting a visible bubble", async status => {
  mocks.run.mockResolvedValue({ ...run(), status }); await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_RUN_INCOMPLETE");
});
it("rejects a run for another human request", async () => {
  mocks.run.mockResolvedValue({ ...run(), inputMessageId: "other-human" }); await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_RUN_INCOMPLETE");
});
it("rejects a mismatched run identity even if its result and human coordinates appear compatible", async () => {
  mocks.run.mockResolvedValue({ ...run(), runId: "another-run" });
  const snapshot = durable(); snapshot.messages[1]!.agentRunId = "another-run"; mocks.messages.mockResolvedValue(snapshot);
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_RUN_INCOMPLETE");
});
it("rejects a provisional assistant ID that never became the actual run result", async () => {
  const snapshot = durable(); snapshot.messages[1]!.id = "streaming-uuid"; mocks.messages.mockResolvedValue(snapshot);
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_REPLY_CHANGED");
});
it("rejects edited reply content or a later student turn", async () => {
  const snapshot = durable(); snapshot.messages[1]!.content = "编辑后的不同文字"; mocks.messages.mockResolvedValue(snapshot);
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_REPLY_CHANGED");
  snapshot.messages.push({ id: "later-human", role: "user", content: "之后又讨论了其它方向", agentRunId: "later-run" }); mocks.messages.mockResolvedValue(snapshot);
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_TURN_CHANGED");
});
it("rejects duplicate identical prompts rather than guessing which turn supplied the artifact", async () => {
  const snapshot = durable(); snapshot.messages.push({ ...snapshot.messages[0]!, id: "duplicate-human" }); mocks.messages.mockResolvedValue(snapshot);
  await expect(readAidtCandidateReply(input())).rejects.toThrow("AIDT_CANDIDATE_REQUEST_NOT_PERSISTED");
});
it("stops a late native request when its source signal is cancelled", async () => {
  const reading = deferred<ReturnType<typeof run>>(); mocks.run.mockReturnValue(reading.promise); const controller = new AbortController();
  const work = readAidtCandidateReply({ ...input(), signal: controller.signal }); const checked = expect(work).rejects.toThrow();
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce()); controller.abort(); reading.resolve(run()); await checked;
});
