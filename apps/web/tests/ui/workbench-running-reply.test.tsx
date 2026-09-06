import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useRunningReply } from "@/lib/chat-workbench/use-running-reply";
const agent = { addMessage: vi.fn() } as unknown as AbstractAgent;
describe("running reply queue", () => {
  it("drains two replies in FIFO order even when run status stays false through resolution", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ text, running }) => useRunningReply({ agent, threadId: "a", run: { runId: null, status: null }, inputDraft: text, sessionToken: null, runIsRunning: running, send, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { text: "first", running: true } });
    await act(() => result.current.sendWhileRunning());
    rerender({ text: "second", running: true });
    await act(() => result.current.sendWhileRunning());
    rerender({ text: "", running: false });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.map((call) => call[0])).toEqual(["first", "second"]);
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
  });
  it("retains failed text and idempotency key for retry and isolates another thread", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = renderHook(({ threadId, running }) => useRunningReply({ agent, threadId, run: { runId: null, status: null }, inputDraft: "keep me", sessionToken: null, runIsRunning: running, send, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { threadId: "a", running: true } });
    await act(() => result.current.sendWhileRunning());
    rerender({ threadId: "a", running: false });
    await waitFor(() => expect(result.current.queuedFailed).toBe(true));
    expect(result.current.queuedReply).toBe("keep me");
    rerender({ threadId: "b", running: false });
    expect(result.current.queuedReply).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    rerender({ threadId: "a", running: false });
    act(() => result.current.retryQueuedReply());
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
    expect(send.mock.calls[0]![1]).toEqual(send.mock.calls[1]![1]);
  });
});
