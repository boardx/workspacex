import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

/**
 * issue #3320 —— 活性条的**逻辑**面（在不在、说什么、随不随执行推进而变）。
 *
 * 几何与「真的在动」在 jsdom 里判不了（没有布局引擎、没有动画时钟），那两条在
 * `e2e/chat-trace-failure-forward-motion-geometry.spec.ts` 里用真浏览器判。
 * 这里判的是 jsdom 判得动、且 e2e 那条单点剧本覆盖不到的那些相位——尤其是
 * 「两件工具之间没有任何在飞的工具」那个空档：底线②说**即使没有细节也一定要有动画**，
 * 所以那一刻活性条不许消失（消失 = 界面又一次"停住"，正是本 issue 的缺陷）。
 */
const base = { runId: "run-3320", emittedAt: "2026-09-10T00:00:00Z" };
const running: ExecutionEvent = { ...base, seq: 1, kind: "status", status: "running" };
const start = (seq: number, id: string, toolName = "edit_file"): ExecutionEvent =>
  ({ ...base, seq, kind: "tool_start", toolCallId: id, toolName, args: {} });
const end = (seq: number, id: string, ok: boolean, toolName = "edit_file"): ExecutionEvent =>
  ({ ...base, seq, kind: "tool_end", toolCallId: id, toolName, result: "", ok });

const renderPanel = (events: ExecutionEvent[], isRunning = false): void => {
  cleanup();
  render(<RunTracePanel runId="run-3320" events={events} running={isRunning} />);
};
afterEach(cleanup);

describe("RunTraceLiveStrip（#3320 失败之后的前进感）", () => {
  it("失败之后仍有工具在飞时：说得出此刻在做什么，且完成步数把失败也算进推进", () => {
    renderPanel([running, start(2, "t1"), end(3, "t1", false), start(4, "t2"), end(5, "t2", true), start(6, "t3", "execute")]);
    const strip = screen.getByTestId("run-trace-live-strip");
    expect(strip).toHaveAttribute("data-has-detail", "true");
    expect(strip).toHaveAttribute("data-completed", "2");
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("正在执行工具操作 · 已完成 2 步");
  });

  it("完成步数随失败之后的每次收尾**增大**——这是「系统仍在推进」唯一会变的可判形态", () => {
    const prefix = [running, start(2, "t1"), end(3, "t1", false)];
    renderPanel(prefix);
    expect(screen.getByTestId("run-trace-live-strip")).toHaveAttribute("data-completed", "1");
    renderPanel([...prefix, start(4, "t2"), end(5, "t2", true)]);
    expect(screen.getByTestId("run-trace-live-strip")).toHaveAttribute("data-completed", "2");
  });

  it("两件工具之间的空档（没有任何在飞的工具）也必须留住活性条——底线②：没细节也要有动画", () => {
    renderPanel([running, start(2, "t1"), end(3, "t1", false)]);
    const strip = screen.getByTestId("run-trace-live-strip");
    expect(strip).toHaveAttribute("data-has-detail", "false");
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("正在推进任务 · 已完成 1 步");
    expect(screen.getByTestId("run-trace-live-spinner").getAttribute("class")).toContain("animate-spin");
  });

  it("活性不取自 running prop —— 本轮吐过 final_message 让它翻假时，活性条照样在", () => {
    // `task-timeline.tsx` 的 `running = isRunning && !有 final_message`。用它当活性来源，
    // 正是「spinner 静止不动」那条缺陷的来源；这里证明活性条与它无关。
    const events: ExecutionEvent[] = [
      running, start(2, "t1"), end(3, "t1", false),
      { ...base, seq: 4, kind: "final_message", messageId: "m1" },
      start(5, "t2", "execute"),
    ];
    renderPanel(events, false);
    expect(screen.getByTestId("run-trace-live-strip")).toBeTruthy();
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("正在执行工具操作 · 已完成 1 步");
  });

  it("run 走到终态后活性条必须消失——否则就成了「永远在转」的假活性", () => {
    for (const terminal of ["succeeded", "failed", "cancelled"] as const) {
      const events: ExecutionEvent[] = [
        running, start(2, "t1"), end(3, "t1", false),
        // ⚠ 故意留一件悬空未收尾的工具：终态到了就是到了，不许因为有 running 条目还转。
        start(4, "t2", "execute"),
        { ...base, seq: 5, kind: "status", status: terminal },
      ];
      renderPanel(events);
      expect(screen.queryByTestId("run-trace-live-strip"), `${terminal} 终态下活性条不该还在`).toBeNull();
    }
  });
});
