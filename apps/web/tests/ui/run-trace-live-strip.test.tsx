import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { RunTraceLiveStrip } from "@/components/chat/workbench/run-trace-live-strip";

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

/** 折叠行的可读文案：不间断空格只是排版手段，判文案时按普通空格看。 */
const line = (element: HTMLElement): string => (element.textContent ?? "").replace(/\u00a0/g, " ");
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
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("正在执行工具操作 · 已完成 2 个动作");
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
    /*
     * 2026-09-22 —— 这条断言从「常量文案」改成「刚收尾的那一步」。
     * 它的**意图没变**：空档里活性条必须还在、完成数必须还在（底线②）。变的是空档里说什么——
     * 原来是恒定的「正在推进任务」，而本地模型两次工具之间要思考几十秒，
     * **「什么都没在飞」才是常态**，于是那句常量是用户大部分时间唯一能看到的字。
     * 现在说刚做完的那一步；`data-has-detail` 仍然为 false（确实没有在飞的工具），
     * 蝴蝶仍然在飞（底线②由折叠行本身满足，与本行文案无关）。
     */
    // 这个夹具里刚收尾的那一步**是失败的**（`end(3, "t1", false)`），所以说的是「刚失败」——
    // 这恰好多证一件事：空档里这一行分得清成功与失败，而恒在的「· 有失败步骤」分不清
    // 「最新一步就是失败」还是「失败之后又跑了三步」（见本组件头注对 (b) 的诊断）。
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("刚失败：执行工具操作 · 已完成 1 个动作");
    // 活性动画是折叠行左侧那枚蝴蝶（`active` 期间恒在恒动）。jsdom 判不了「真的在动」，
    // 那条在 e2e/chat-trace-failure-forward-motion-geometry.spec.ts 里用两帧比对判。
    expect(screen.getByTestId("copilotkit-v2-thinking-mark").getAttribute("class")).toContain("animate-butterfly-fly");
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
    expect(screen.getByTestId("run-trace-live-label").textContent).toBe("正在执行工具操作 · 已完成 1 个动作");
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

  /**
   * 2026-09-10 人类实测：「工具调用的 2 个消息重复了」——折叠行说「正在执行 · 历时 02:10 · …」
   * 带一只在飞的蝴蝶，紧接着**另起一行**又说「正在执行工具操作 · 已完成 3 步」带一枚在转的
   * `Loader2`。两句话、两个活性动画、零新增信息。收敛后活性文案必须与折叠行**同处一行**，
   * 且整块面板里只剩一个活性动画。
   */
  it("活性文案与折叠行是同一行，且这一行不再重复说一遍「正在执行」", () => {
    renderPanel([running, start(2, "t1"), end(3, "t1", true), start(4, "t2", "execute")]);
    const toggle = line(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByTestId("run-trace-toggle").contains(screen.getByTestId("run-trace-live-strip")), "活性文案必须在折叠行里，不许另起一行").toBe(true);
    // 历时是走动的时钟，只判形状。
    // 技能活动为 0 时不显示（2026-09-17 人类反馈）
    expect(toggle).toMatch(/^正在执行工具操作 · 已完成 1 个动作 · 历时 \d+:\d{2} · 工具 2 次$/);
    // 折叠行只说一次「正在执行」：活性文案说了，标题就不再重复。
    expect(toggle.match(/正在执行/g)).toHaveLength(1);
    // 活性动画只剩蝴蝶那一枚——另一枚 `Loader2` 活性条已经不存在。
    expect(screen.queryByTestId("run-trace-live-spinner"), "重复的第二个活性动画不该再有").toBeNull();
  });

  it("失败过但仍在跑时：「有失败步骤」这条恒定事实留在同一行的后半段", () => {
    renderPanel([running, start(2, "t1"), end(3, "t1", false), start(4, "t2", "execute")]);
    const toggle = line(screen.getByTestId("run-trace-toggle"));
    expect(toggle).toMatch(/^正在执行工具操作 · 已完成 1 个动作 · 有失败步骤 · 历时 \d+:\d{2} · 工具 2 次$/);
  });
});

/**
 * E2（评测集第 2 轮）—— **静默窗口里也要有随时间变化的事实**。
 *
 * 实测：慢剧本模拟模型思考 12 秒期间执行过程一行都没有，这一行退化成恒定的
 * 「正在推进任务」，整轮 90 秒采样只读到一种文案——与「卡死了」在屏幕上无法区分。
 */
describe("静默窗口：已等待时长", () => {
  it("没有任何步骤时，超过 3 秒开始报已等待时长，并逐秒变化", () => {
    vi.useFakeTimers();
    try {
      render(<RunTraceLiveStrip entries={[]} active />);
      // 前 3 秒不报——一两秒就跳数字是噪音，不是信息。
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(screen.getByTestId("run-trace-live-strip").textContent).not.toContain("已等待");

      act(() => { vi.advanceTimersByTime(3_000); });
      const at5 = screen.getByTestId("run-trace-live-strip").textContent ?? "";
      expect(at5).toContain("已等待 5 秒");

      act(() => { vi.advanceTimersByTime(4_000); });
      expect(screen.getByTestId("run-trace-live-strip").textContent).toContain("已等待 9 秒");
    } finally {
      vi.useRealTimers();
    }
  });

  it("run 结束后不再计时（active=false 整条不渲染）", () => {
    const { rerender } = render(<RunTraceLiveStrip entries={[]} active />);
    rerender(<RunTraceLiveStrip entries={[]} active={false} />);
    expect(screen.queryByTestId("run-trace-live-strip")).toBeNull();
  });
});
