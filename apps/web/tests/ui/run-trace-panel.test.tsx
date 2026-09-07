import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const start: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", toolCallId: "tool-1", toolName: "search", args: { query: "资料" } };
describe("run trace disclosure", () => {
  it("collapses even one tool by default and retains user expansion as streaming updates arrive", () => {
    const { rerender } = render(<RunTracePanel runId="run-1" events={[start]} running />);
    const toggle = screen.getByTestId("run-trace-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("run-trace-body")).not.toBeVisible();
    expect(toggle).toHaveAttribute("aria-controls", screen.getByTestId("run-trace-body").id);
    fireEvent.click(toggle);
    const end: ExecutionEvent = { ...base, seq: 2, kind: "tool_end", toolCallId: "tool-1", toolName: "search", result: "done", ok: true };
    rerender(<RunTracePanel runId="run-1" events={[start, end]} />);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "succeeded");
    expect(screen.getByText("done")).not.toBeVisible();
    fireEvent.click(screen.getByText("Tool · search"));
    expect(screen.getByText("done")).toBeVisible();
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
