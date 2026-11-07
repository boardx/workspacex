import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
vi.mock("@/components/chat/subtask-run-live-panel", () => ({ SubtaskRunLivePanel: () => null }));
const events: ExecutionEvent[] = [{ runId: "failed", seq: 1, emittedAt: "2026-11-05T00:00:00Z", kind: "status", status: "failed" }];
describe("failure controls #6244", () => {
  beforeEach(() => localStorage.clear());
  it("retains hidden records on remount, isolates scope, and restores them", () => {
    const view = render(<RunTracePanel runId="failed" events={events} failureScope="org/thread" />);
    fireEvent.click(screen.getByText("隐藏失败记录"));
    expect(screen.queryByTestId("run-trace-panel")).not.toBeInTheDocument();
    view.unmount();
    const next = render(<RunTracePanel runId="failed" events={events} failureScope="org/thread" />);
    expect(screen.getByTestId("run-trace-hidden")).toBeVisible();
    next.rerender(<RunTracePanel runId="failed" events={events} failureScope="other/thread" />);
    expect(screen.getByTestId("run-trace-panel")).toBeVisible();
    next.rerender(<RunTracePanel runId="failed" events={events} failureScope="org/thread" />);
    fireEvent.click(screen.getByText("恢复显示"));
    expect(screen.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(events[0]).toMatchObject({ status: "failed" });
  });
  it("does not reuse the hidden preference for a new attempt of the same run", () => {
    const view = render(<RunTracePanel runId="failed" events={events.map((event) => ({ ...event, attemptId: "first" }))} failureScope="org/thread" />);
    fireEvent.click(screen.getByText("隐藏失败记录"));
    view.rerender(<RunTracePanel runId="failed" events={events.map((event) => ({ ...event, attemptId: "second" }))} failureScope="org/thread" />);
    expect(screen.getByTestId("run-trace-panel")).toBeVisible();
  });
  it("can hide a succeeded run with a real failed tool, without offering run retry", () => {
    const trace: ExecutionEvent[] = [
      { ...events[0]!, kind: "tool_start", toolCallId: "t", toolName: "execute", args: {} },
      { ...events[0]!, seq: 2, kind: "tool_end", toolCallId: "t", toolName: "execute", ok: false, result: "failed" },
      { ...events[0]!, seq: 3, kind: "status", status: "succeeded" },
    ];
    render(<RunTracePanel runId="failed" events={trace} failureScope="org/thread" onRetryFailure={vi.fn()} />);
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("隐藏失败记录"));
    expect(screen.getByTestId("run-trace-hidden")).toBeVisible();
  });
  it("offers retry only when the host supplies an eligible recovery action", () => {
    const retry = vi.fn();
    const view = render(<RunTracePanel runId="failed" events={events} onRetryFailure={retry} />);
    fireEvent.click(screen.getByText("重试"));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<RunTracePanel runId="failed" events={events} />);
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
  });
  it("does not hide a live or successful run because a prior attempt was hidden", () => {
    const view = render(<RunTracePanel runId="failed" events={events} failureScope="org/thread" />);
    fireEvent.click(screen.getByText("隐藏失败记录"));
    view.rerender(<RunTracePanel runId="failed" events={[...events, { ...events[0]!, seq: 2, kind: "status", status: "running" }]} failureScope="org/thread" />);
    expect(screen.getByTestId("run-trace-panel")).toBeVisible();
    expect(screen.queryByText("隐藏失败记录")).not.toBeInTheDocument();
  });
});
