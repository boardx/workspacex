import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useRunningReply } from "@/lib/chat-workbench/use-running-reply";
const agent = { addMessage: vi.fn() } as unknown as AbstractAgent;
describe("queued draft acceptance", () => {
  beforeEach(() => sessionStorage.clear());
  it("persists replies in FIFO order even while the business run is paused", async () => {
    const enqueue = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ text }) => useRunningReply({ agent, threadId: "a", run: { runId: "run", status: "paused" }, inputDraft: text, sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { text: "first" } });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
    rerender({ text: "second" });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual(["first", "second"]);
  });
  it("retains failed text and request identity for retry and isolates another thread", async () => {
    const enqueue = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = renderHook(({ threadId }) => useRunningReply({ agent, threadId, run: { runId: null, status: null }, inputDraft: "keep me", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { threadId: "a" } });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(result.current.queuedFailed).toBe(true));
    expect(result.current.queuedReply).toBe("keep me");
    rerender({ threadId: "b" });
    expect(result.current.queuedReply).toBeNull();
    rerender({ threadId: "a" });
    act(() => result.current.retryQueuedReply());
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
    expect(enqueue.mock.calls[0]![1]).toEqual(enqueue.mock.calls[1]![1]);
  });
  it("restores unacknowledged drafts after refresh without silently submitting again", async () => {
    const enqueue = vi.fn().mockResolvedValue(false);
    const setup = () => useRunningReply({ agent, threadId: "restore", run: { runId: "run", status: "awaiting_tool_permission" }, inputDraft: "local draft", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() });
    const first = renderHook(setup);
    await act(() => first.result.current.sendWhileRunning());
    await waitFor(() => expect(first.result.current.queuedFailed).toBe(true));
    first.unmount();
    const second = renderHook(setup);
    expect(second.result.current.queuedReply).toBe("local draft");
    expect(enqueue).toHaveBeenCalledTimes(1);
    enqueue.mockResolvedValue(true);
    act(() => second.result.current.retryQueuedReply());
    await waitFor(() => expect(second.result.current.queuedReply).toBeNull());
  });
  it("lets the user explicitly queue while a run is running", async () => {
    const enqueue = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useRunningReply({ agent, threadId: "a", run: { runId: "active", status: "running" }, inputDraft: "later", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }));
    await act(() => result.current.sendWhileRunning({ forceQueue: true }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledWith("later", expect.objectContaining({ clientMessageId: expect.any(String) })));
    expect(result.current.runningReplyAck).toBeNull();
  });

});
