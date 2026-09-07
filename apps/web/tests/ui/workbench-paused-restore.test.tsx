import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-run", async (original) => ({ ...(await original<typeof import("@/lib/agent-run")>()), getAgentRun: read }));
vi.mock("@/lib/agent-kernel-stream", async (original) => ({ ...(await original<typeof import("@/lib/agent-kernel-stream")>()), useAgentKernelRunStream: () => ({ reconnectState: null }) }));
import { useCopilotKitV2RunRestore } from "@/lib/copilotkit-v2-run-restore";
afterEach(() => { vi.useRealTimers(); read.mockReset(); });
describe("paused run restoration", () => {
  it("keeps a paused run resumable beyond stall timeout and observes resumed execution", async () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    read.mockResolvedValue({ id: "run", status: "paused" });
    const { result } = renderHook(() => useCopilotKitV2RunRestore("run", "token", onSettled));
    await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
    expect(result.current.isRestoring).toBe(false);
    expect(result.current.status).toBe("paused");
    expect(result.current.runId).toBe("run");
    expect(onSettled).not.toHaveBeenCalled();
    read.mockResolvedValue({ id: "run", status: "running" });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.isRestoring).toBe(true);
    read.mockResolvedValue({ id: "run", status: "cancelled" });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.isRestoring).toBe(false);
  });
});
