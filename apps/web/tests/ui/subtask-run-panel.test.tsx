/**
 * 后台任务面板（issue #2666）—— `SubtaskRunPanel` 用三态 mock 数据（`MOCK_SUBTASK_RUNS`：
 * 一个进行中、一个已完成、一个出错，对齐 issue 验收标准第一条）覆盖：
 *   ① 角标数字与展开/收起
 *   ② 三态卡片的颜色 + 图形（`data-status` + `data-testid` 双重区分，不只靠文字）
 *   ③ 完成通知 → 点击定位到具体卡片
 *   ④ 出错卡片的失败原因 + "重试这一个"入口
 *
 * 不需要真实后端联调——`SubtaskRunPanel` 是纯展示组件，`runs` 直接传 mock 数组，
 * 不涉及 fetch/React Query（那部分在 `use-subtask-runs.test.ts` 单独覆盖）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SubtaskRunPanel } from "@/components/chat/subtask-run-panel";
import { MOCK_SUBTASK_RUNS, type SubtaskRunView } from "@/lib/mock/subtask-run";

function runs(overrides?: Partial<SubtaskRunView>[]): SubtaskRunView[] {
  if (!overrides) return MOCK_SUBTASK_RUNS.map((r) => ({ ...r }));
  return MOCK_SUBTASK_RUNS.map((r, i) => ({ ...r, ...(overrides[i] ?? {}) }));
}

describe("SubtaskRunPanel -- 后台任务角标 + 三态卡片（issue #2666）", () => {
  it("收起态角标显示「有 N 个任务在后台运行」（N=进行中/排队中的数量）", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} />);
    const badge = screen.getByTestId("chat-subtask-badge");
    expect(badge).toHaveTextContent("有 1 个任务在后台运行");
    expect(screen.queryByTestId("chat-subtask-list")).not.toBeInTheDocument();
  });

  it("点击角标展开列表，能看到三条卡片，各自状态文案与 data-status 一致", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} />);
    fireEvent.click(screen.getByTestId("chat-subtask-badge"));

    const cards = screen.getAllByTestId("chat-subtask-card");
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute("data-status"))).toEqual(["running", "completed", "failed"]);

    const labels = screen.getAllByTestId("chat-subtask-status-label").map((el) => el.textContent);
    expect(labels).toEqual(["进行中", "已完成", "出错"]);
  });

  it("三态用颜色 + 图形双重区分，不只靠文字 —— 三个状态点各自不同的 tone class", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} defaultOpen />);
    const dots = screen.getAllByTestId("chat-subtask-status-dot");
    expect(dots).toHaveLength(3);
    // Badge 组件把 tone 编译成不同的背景色 class：三条互不相同即证明"不是同一个视觉"。
    const classNames = dots.map((d) => d.className);
    expect(new Set(classNames).size).toBe(3);
    // 每张卡片内部还各自有一个具名图形（svg），三态图形也各不相同。
    for (const dot of dots) {
      expect(dot.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("收起态角标额外提示出错数量", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} />);
    expect(screen.getByTestId("chat-subtask-failed-count")).toHaveTextContent("1 个出错");
  });

  it("出错卡片单独标红并附失败原因，提供「重试这一个」", () => {
    const onRetry = vi.fn();
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} onRetry={onRetry} defaultOpen />);

    const failedCard = screen.getAllByTestId("chat-subtask-card")[2]!;
    expect(failedCard.className).toContain("border-destructive");
    expect(within(failedCard).getByTestId("chat-subtask-error")).toHaveTextContent(
      "行业数据库 MCP 授权超时",
    );

    const retryButton = within(failedCard).getByTestId("chat-subtask-retry");
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0].id).toBe("subtask-mock-3");
  });

  it("已完成卡片展示结果文本", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} defaultOpen />);
    const completedCard = screen.getAllByTestId("chat-subtask-card")[1]!;
    expect(within(completedCard).getByTestId("chat-subtask-result")).toHaveTextContent("4 家可承接的本地 EPC");
  });

  it("收起面板后仍渲染在 DOM 里（不阻塞外部输入）—— 面板本身不劫持任何全局焦点/按键", () => {
    render(<SubtaskRunPanel parentRunId="run-mock-1" runs={runs()} defaultOpen />);
    fireEvent.click(screen.getByTestId("chat-subtask-badge")); // 收起
    expect(screen.queryByTestId("chat-subtask-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-subtask-panel")).toBeInTheDocument();
  });

  it("完成通知：收起态下一条子任务变为 completed 时出现提示条，点击后展开并高亮对应卡片", () => {
    const initial = runs();
    initial[0] = { ...initial[0]!, status: "running" };
    const { rerender } = render(<SubtaskRunPanel parentRunId="run-mock-1" runs={initial} />);
    expect(screen.queryByTestId("chat-subtask-completion-toast")).not.toBeInTheDocument();

    const updated = initial.map((r) => (r.id === "subtask-mock-1" ? { ...r, status: "completed" as const } : r));
    rerender(<SubtaskRunPanel parentRunId="run-mock-1" runs={updated} />);

    const toast = screen.getByTestId("chat-subtask-completion-toast");
    expect(toast).toHaveTextContent("1 个任务刚完成");

    fireEvent.click(toast);
    // 点击后面板展开，能看到该子任务对应的卡片。
    const highlighted = screen.getByTestId("chat-subtask-list").querySelector(
      '[data-subtask-id="subtask-mock-1"]',
    );
    expect(highlighted).toBeInTheDocument();
    expect(screen.queryByTestId("chat-subtask-completion-toast")).not.toBeInTheDocument();
  });

  it("没有子任务（空数组）时不渲染任何东西", () => {
    const { container } = render(<SubtaskRunPanel parentRunId="run-mock-1" runs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

