/**
 * issue #2860 —— 恢复路径不再只等一个可能永远不来的事件：权威读读到"还在跑"后有界复读。
 * 幽灵 run 场景（API 重启，run 卡 running、WS 连得上但零事件）此前会让「正在恢复上次
 * 未完成的任务…」永远不动。这里把事件流 mock 成"connected 但静默"，只靠复读收敛。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { getAgentRun } = vi.hoisted(() => ({ getAgentRun: vi.fn() }));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/lib/agent-kernel-stream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-kernel-stream")>()),
  // WS 连上了、但永远不来事件——重启后回放缓冲为空的真实形状。
  useAgentKernelRunStream: () => ({ reconnectState: "connected", attempts: 0 }),
}));

import { useCopilotKitV2RunRestore, type RunRestoreOutcome } from "@/lib/copilotkit-v2-run-restore";

const running = { runId: "run-1", status: "running", error: null } as never;
const interrupted = { runId: "run-1", status: "failed", error: "RUN_INTERRUPTED" } as never;

beforeEach(() => { vi.useFakeTimers(); getAgentRun.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

async function flush(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("useCopilotKitV2RunRestore —— 有界复读（issue #2860）", () => {
  it("服务端回收器把幽灵 run 收敛成 failed(RUN_INTERRUPTED) 后，复读读到终态 ⇒ settled，不必等事件", async () => {
    getAgentRun.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValue(interrupted);
    const outcomes: RunRestoreOutcome[] = [];
    const { result } = renderHook(() => useCopilotKitV2RunRestore("run-1", "bearer", (o) => void outcomes.push(o)));
    await flush(0);
    expect(result.current.isRestoring).toBe(true);
    await flush(5_000 * 2 + 100);
    expect(outcomes).toEqual([{ kind: "settled", view: interrupted }]);
    expect(result.current.isRestoring).toBe(false);
    expect(getAgentRun).toHaveBeenCalledTimes(3);
  });

  it("超过复读上限仍非终态 ⇒ gave-up(stalled)，如实说没进展、不冒充失败", async () => {
    getAgentRun.mockResolvedValue(running);
    const outcomes: RunRestoreOutcome[] = [];
    const { result } = renderHook(() => useCopilotKitV2RunRestore("run-1", "bearer", (o) => void outcomes.push(o)));
    await flush(0);
    await flush(200_000);
    expect(outcomes).toEqual([]);
    await flush(20_000);
    expect(outcomes).toEqual([{ kind: "gave-up", reason: "stalled" }]);
    expect(result.current.isRestoring).toBe(false);
  });

  it("首次权威读就是终态 ⇒ 立即 settled，一次复读都不发（#2825 行为不变）", async () => {
    getAgentRun.mockResolvedValue(interrupted);
    const outcomes: RunRestoreOutcome[] = [];
    renderHook(() => useCopilotKitV2RunRestore("run-1", "bearer", (o) => void outcomes.push(o)));
    await flush(0);
    expect(outcomes).toEqual([{ kind: "settled", view: interrupted }]);
    await flush(30_000);
    expect(getAgentRun).toHaveBeenCalledTimes(1);
  });
});
