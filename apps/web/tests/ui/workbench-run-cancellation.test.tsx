import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunCancellation } from "@/lib/chat-workbench/use-run-cancellation";
const calls = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
afterEach(() => { vi.useRealTimers(); calls.request.mockReset(); calls.read.mockReset(); });
describe("server cancellation", () => {
  it("keeps stopping state until server terminal confirmation", async () => {
    vi.useFakeTimers();
    calls.read.mockResolvedValue({ status: "running", cancelRequestedAt: null });
    calls.request.mockResolvedValue({ runId: "r", status: "cancel_requested" });
    const { result } = renderHook(() => useRunCancellation("r", "token"));
    await act(async () => { await Promise.resolve(); });
    await act(() => result.current.cancel());
    expect(calls.request).toHaveBeenCalledWith("/agent-runs/r/cancel", expect.objectContaining({ method: "POST" }));
    expect(result.current.requested).toBe(true);
    calls.read.mockResolvedValue({ status: "cancelled", cancelRequestedAt: "now" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(result.current.requested).toBe(false);
  });
  it("allows retry after a failed cancellation command", async () => {
    calls.read.mockResolvedValue({ status: "running", cancelRequestedAt: null });
    calls.request.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useRunCancellation("r", "token"));
    await act(() => result.current.cancel());
    await waitFor(() => expect(result.current.failure).toContain("重试"));
    expect(result.current.requested).toBe(false);
    expect(result.current.canCancel).toBe(true);
    calls.request.mockResolvedValue({ runId: "r", status: "cancel_requested" });
    await act(() => result.current.cancel());
    expect(result.current.requested).toBe(true);
  });
});
