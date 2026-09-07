import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadMessageQueue } from "@/lib/chat-workbench/use-thread-message-queue";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: request }));
const id = "11111111-1111-4111-8111-111111111111";
const item = { id, clientRequestId: id, text: "next", agentId: "agent", status: "pending", runId: null, createdAt: "now", error: null };
afterEach(() => { request.mockReset(); vi.useRealTimers(); });
describe("server queue transport", () => {
  it("only acknowledges after persistence and recovers accepted items after remount", async () => {
    request.mockResolvedValue({ items: [] });
    const first = renderHook(() => useThreadMessageQueue("thread", null, "token"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    request.mockResolvedValue(item);
    await act(async () => { expect(await first.result.current.enqueue("next", { clientMessageId: id })).toBe(true); });
    expect(request).toHaveBeenLastCalledWith("/chat/threads/thread/queued-messages", expect.objectContaining({ method: "POST", body: { clientRequestId: id, text: "next", agentId: null } }));
    expect(first.result.current.items).toEqual([item]);
    first.unmount();
    request.mockResolvedValue({ items: [item] });
    const recovered = renderHook(() => useThreadMessageQueue("thread", null, "token"));
    await waitFor(() => expect(recovered.result.current.items).toEqual([item]));
    request.mockResolvedValue({ ...item, status: "cancelled" });
    await act(() => recovered.result.current.cancel(id));
    expect(recovered.result.current.items[0]?.status).toBe("cancelled");
  });
  it("keeps acceptance failures negative and never leaks the previous thread queue", async () => {
    request.mockResolvedValue({ items: [item] });
    const { result, rerender } = renderHook(({ threadId }) => useThreadMessageQueue(threadId, "agent", "token"), { initialProps: { threadId: "a" } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    request.mockRejectedValue(new Error("network"));
    await act(async () => { expect(await result.current.enqueue("next", { clientMessageId: id })).toBe(false); });
    request.mockResolvedValue({ items: [] });
    rerender({ threadId: "b" });
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });
  it("clears an old read error after the authoritative poll recovers", async () => {
    vi.useFakeTimers();
    request.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useThreadMessageQueue("thread", null, "token"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe("offline");
    request.mockResolvedValue({ items: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.error).toBeNull();
  });

});
