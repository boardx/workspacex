import * as React from "react";
import { describe, it, expect } from "vitest";
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
});
