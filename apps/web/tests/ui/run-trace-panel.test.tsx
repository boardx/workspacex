import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
vi.mock("@/components/chat/subtask-run-live-panel", () => ({
  SubtaskRunLivePanel: ({ parentRunId }: { parentRunId: string | null }) => <div data-testid="subtask-live">{parentRunId}</div>,
}));
const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const start: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", toolCallId: "tool-1", toolName: "search", args: { query: "资料" } };
describe("run trace disclosure", () => {
  it("collapses even one tool by default and retains user expansion as streaming updates arrive", () => {
    const { rerender } = render(<RunTracePanel runId="run-1" events={[start]} running />);
    const toggle = screen.getByTestId("run-trace-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("copilotkit-v2-thinking-mark")).toHaveClass("animate-butterfly-fly", "motion-reduce:animate-none");
    expect(screen.getByTestId("run-trace-body")).not.toBeVisible();
    expect(toggle).toHaveAttribute("aria-controls", screen.getByTestId("run-trace-body").id);
    fireEvent.click(toggle);
    const end: ExecutionEvent = { ...base, seq: 2, kind: "tool_end", toolCallId: "tool-1", toolName: "search", result: "done", ok: true };
    rerender(<RunTracePanel runId="run-1" events={[start, end]} />);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "succeeded");
    expect(screen.getByText("done")).not.toBeVisible();
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent("已执行工具操作");
    expect(screen.getByTestId("chat-task-workbench-event-row")).not.toHaveTextContent("search");
    fireEvent.click(screen.getByText("已执行工具操作"));
    expect(screen.getByText("done")).toBeVisible();
  });
  it("mounts durable subtask projection only when the journal recorded a dispatch", () => {
    const spawn: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", toolCallId: "tool-sub", toolName: "spawn_async_task", args: { description: "检索资料" } };
    render(<RunTracePanel runId="run-1" events={[spawn]} />);
    /*
     * issue #3100 D6 —— 「有子任务在后台跑」这件事**不许**被埋在执行过程的折叠区里。
     * 面板此前挂在 `run-trace-body` 内，而那个区块默认 `hidden`：TW-P0-7③ 要断言的
     * 「子 Agent 节点默认是收起的摘要态」在真实浏览器里根本不可见，用户不点开执行
     * 过程就看不到后台任务。这两行就是那道闸的会红断言——把面板挪回折叠区内，
     * 第二行立刻红。
     */
    expect(screen.getByTestId("run-trace-body")).not.toBeVisible();
    expect(screen.getByTestId("subtask-live")).toBeVisible();
    expect(screen.getByTestId("subtask-live")).toHaveTextContent("run-1");
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent("正在派发后台任务");
  });

  it("keeps the subtask projection unmounted when no dispatch was recorded", () => {
    render(<RunTracePanel runId="run-1" events={[start]} />);
    // 反面：挂载条件没有被放宽成"总是挂"——没派发过就一个都不挂。
    expect(screen.queryByTestId("subtask-live")).toBeNull();
  });
  it("shows a status-only disclosure and uses durable pause timestamps without a running spinner", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:20Z"));
    const statusEvents: ExecutionEvent[] = [
      { ...base, seq: 0, kind: "status", status: "running" },
      { ...base, seq: 1, emittedAt: "2026-09-07T00:00:04Z", kind: "status", status: "paused" },
    ];
    const { container } = render(<RunTracePanel runId="run-1" events={statusEvents} running />);
    expect(screen.getByTestId("run-trace-toggle")).toHaveTextContent("已暂停 · 历时 00:04");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("copilotkit-v2-thinking-mark")).toBeNull();
    vi.useRealTimers();
  });

  it("labels legacy text as historical public content and never invents a live run", () => {
    const events: ExecutionEvent[] = [{ ...base, source: "legacy", seq: 0, kind: "text_delta", messageId: "legacy-text", delta: "旧公开记录" }];
    const { container } = render(<RunTracePanel runId="run-1" events={events} running />);
    expect(screen.getByTestId("run-trace-toggle")).toHaveTextContent("历史执行记录");
    expect(container.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByText("历史公开记录")).toBeVisible();
    expect(screen.getByText("旧公开记录")).toBeVisible();
  });

});
