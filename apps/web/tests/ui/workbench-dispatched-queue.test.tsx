import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
import { useDispatchedQueueMessages } from "@/lib/chat-workbench/use-dispatched-queue-messages";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-run", () => ({ getAgentRun: read }));
describe("dispatched queue identity", () => {
  it("adds the real accepted user message before enabling its journal and isolates scope synchronously", async () => {
    read.mockResolvedValue({ runId: "run", inputMessageId: "accepted-message" });
    const addMessage = vi.fn(); const agent = { messages: [], addMessage } as unknown as AbstractAgent;
    const register = vi.fn(); const bind = vi.fn();
    const items = [{ id: "queue", runId: "run", status: "dispatched", text: "queued text" }] as QueuedMessage[];
    const { result, rerender } = renderHook(({ thread }) => useDispatchedQueueMessages(agent, thread === "a" ? items : [], thread, "token", register, bind), { initialProps: { thread: "a" } });
    await waitFor(() => expect(result.current).toEqual(["run"]));
    expect(addMessage).toHaveBeenCalledWith({ id: "accepted-message", role: "user", content: "queued text" });
    expect(register).toHaveBeenCalledWith([{ id: "accepted-message", rateable: false }]);
    rerender({ thread: "b" });
    expect(result.current).toEqual([]);
  });
});
