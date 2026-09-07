import { beforeEach, expect, it, vi } from "vitest";
const listMessages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/live-chat", () => ({ listMessages }));
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
beforeEach(() => listMessages.mockReset());
it("reads beyond 50 pages without silently dropping older conversation history", async () => {
  for (let page = 0; page < 51; page += 1) listMessages.mockResolvedValueOnce({
    messages: [{ id: `m-${page}`, authorKind: "human", authorId: "user", text: String(page), agentRunId: null, replyToMessageId: null }],
    nextCursor: page === 50 ? null : String(page + 1),
  });
  const history = await readAllPersistedMessages("thread", "test-session");
  expect(history.messages).toHaveLength(51);
  expect(history.messages.at(-1)?.id).toBe("m-50");
});
it("fails visibly when the server repeats a cursor instead of looping or reporting complete history", async () => {
  listMessages.mockResolvedValue({ messages: [], nextCursor: "stuck" });
  await expect(readAllPersistedMessages("thread", "test-session")).rejects.toThrow("repeated cursor");
  expect(listMessages).toHaveBeenCalledTimes(2);
});
