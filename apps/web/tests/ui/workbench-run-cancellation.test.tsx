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

describe("child cancellation facts", () => {
  it("continues bounded-backoff reads after parent cancellation and clears notice only on confirmation", async () => {
    vi.useFakeTimers();
    calls.read.mockResolvedValue({ status: "cancelled", cancelRequestedAt: "now", childCancellation: { kind: "pending", runningChildIds: ["child"] } });
    const hook = renderHook(() => useRunCancellation("parent", "token"));
    await act(async () => {});
    expect(hook.result.current.requested).toBe(false);
    expect(hook.result.current.childNotice).toBe("父任务已停止，子任务仍待停止确认。");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(calls.read).toHaveBeenCalledTimes(2);
    calls.read.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(hook.result.current.childNotice).toContain("仍待停止确认");
    calls.read.mockResolvedValue({ status: "cancelled", cancelRequestedAt: "now", childCancellation: { kind: "confirmed" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(hook.result.current.childNotice).toBeNull();
    const count = calls.read.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(calls.read).toHaveBeenCalledTimes(count);
  });
  it("hides the old task immediately and aborts pending reads on navigation/unmount", async () => {
    vi.useFakeTimers();
    calls.read.mockResolvedValue({ status: "cancelled", cancelRequestedAt: "now", childCancellation: { kind: "pending", runningChildIds: ["child"] } });
    const hook = renderHook(({ run }) => useRunCancellation(run, "token"), { initialProps: { run: "old" as string | null } });
    await act(async () => {});
    expect(hook.result.current.childNotice).not.toBeNull();
    hook.rerender({ run: null });
    expect(hook.result.current.childNotice).toBeNull();
    const count = calls.read.mock.calls.length;
    expect(calls.read.mock.calls[0]?.[2].aborted).toBe(true);
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(calls.read).toHaveBeenCalledTimes(count);
  });
  it("projects unavailable without falsely keeping the parent running, and ignores not_requested", async () => {
    calls.read.mockResolvedValue({ status: "cancelled", cancelRequestedAt: "now", childCancellation: { kind: "unavailable" } });
    const hook = renderHook(({ run }) => useRunCancellation(run, "token"), { initialProps: { run: "old" } });
    await waitFor(() => expect(hook.result.current.childNotice).toBe("子任务停止状态未确认。"));
    expect(hook.result.current.requested).toBe(false);
    calls.read.mockResolvedValue({ status: "running", childCancellation: { kind: "not_requested" } });
    hook.rerender({ run: "new" });
    await act(async () => {});
    expect(hook.result.current.childNotice).toBeNull();
  });
});
