/**
 * 2026-09-22 —— 长时间不返回的工具调用要在界面上说一句（本地版）。
 *
 * 为什么这是缺陷而不是锦上添花：本地一次画布请求是**分钟级**，界面上只有一个转圈的
 * 图标，用户分不出「还在跑」和「卡死了」——人类给的那张截图就是这一幕的终点。
 *
 * 三条纪律的反证都在这里：写的是 `tool_progress`（不碰终态）、写失败不抛、
 * 在线版一个计时器都不创建（`toolStallNoticeMs("cloud") === null`）。
 */
import { expect, it, vi } from "vitest";
import { toolStallNotice, toolStallNoticeMs } from "@repo/contracts/deployment";
import { OpenToolCalls, type ToolStallWatch } from "../../src/application/agent-run/open-tool-calls";

const pendingEnd = {
  kind: "tool_end" as const, attemptId: "attempt-1", toolCallId: "attempt-1:call-1",
  sourceToolCallId: "call-1", toolName: "call_skill", result: null, ok: false,
};

function watch(notify: ToolStallWatch["notify"]): ToolStallWatch {
  return { afterMs: 1_000, repeatEveryMs: 1_000, notify };
}

it("only the local edition asks for the notice at all", () => {
  expect(toolStallNoticeMs("cloud")).toBeNull();
  expect(toolStallNoticeMs("local")).toBe(60_000);
  // 文案里必须有真实分钟数，且明确说这不是卡死——否则它只是第二个转圈图标
  const said = toolStallNotice("call_skill", 185_000);
  expect(said).toContain("3 分钟");
  expect(said).toContain("不是卡死");
});

it("says one line after the threshold, then keeps saying it until the call closes", async () => {
  vi.useFakeTimers();
  try {
    const seen: number[] = [];
    const open = new OpenToolCalls(watch(async ({ elapsedMs, toolName, toolCallId }) => {
      expect(toolName).toBe("call_skill");
      expect(toolCallId).toBe("attempt-1:call-1");
      seen.push(elapsedMs);
    }));
    open.open("attempt-1:call-1", pendingEnd);
    expect(seen).toEqual([]);                        // 阈值之前一句都不说
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.length).toBe(2);
    open.close("attempt-1:call-1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen.length).toBe(2);                     // 闭掉之后不再说
  } finally { vi.useRealTimers(); }
});

it("creates no timer at all when no watch is injected -- the cloud path", async () => {
  vi.useFakeTimers();
  try {
    const open = new OpenToolCalls();
    open.open("attempt-1:call-1", pendingEnd);
    // 反证：未注入时连一个待触发的计时器都不该存在
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("a failing notice writer neither throws nor stops the next one", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const open = new OpenToolCalls(watch(async () => { calls += 1; throw new Error("journal down"); }));
    open.open("attempt-1:call-1", pendingEnd);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
  } finally { vi.useRealTimers(); }
});

it("closeAll clears the timers -- a finished run never notices again", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const open = new OpenToolCalls(watch(async () => { calls += 1; }));
    open.open("attempt-1:call-1", pendingEnd);
    await open.closeAll("failed", async () => {}, () => {});
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(0);
  } finally { vi.useRealTimers(); }
});
