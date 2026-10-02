import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
vi.mock("@/components/chat/subtask-run-live-panel", () => ({ SubtaskRunLivePanel: () => null }));
const base = { runId: "stopped-run", emittedAt: "2026-09-07T00:00:00Z" };
const start: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", toolCallId: "unfinished-tool", toolName: "execute", args: {} };
describe("unfinished tools after a run settles (#3360)", () => {
  it("also stops a skill execution fact without inventing its outcome", () => {
    const skill: ExecutionEvent = { ...base, seq: 1, kind: "skill_activity", fact: {
      contractVersion: 1, factId: "skill-fact", skillId: "pdf", skillStableName: "pdf-create",
      skillVersion: "v1", packageDigest: "a".repeat(64), toolCallId: "skill-tool", stage: "execution_started",
    } };
    render(<RunTracePanel runId={base.runId} events={[skill, { ...base, seq: 2, kind: "status", status: "failed" }]} />);
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    const icon = screen.getByTestId("run-trace-entry-status-icon");
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent(icon.getAttribute("aria-label")!);
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "running");
  });

  it("keeps the active tool text and icon consistent", () => {
    render(<RunTracePanel runId={base.runId} events={[start, { ...base, seq: 2, kind: "status", status: "running" }]} running />);
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent("正在执行");
    expect(screen.getByTestId("run-trace-entry-status-icon")).toHaveClass("animate-spin");
  });
  it.each(["failed", "cancelled", "succeeded"] as const)("does not describe an unfinished tool as executing after %s", (status) => {
    render(<RunTracePanel runId={base.runId} events={[start, { ...base, seq: 2, kind: "status", status }]} />);
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    const row = screen.getByTestId("chat-task-workbench-event-row");
    const icon = screen.getByTestId("run-trace-entry-status-icon");
    expect(row).not.toHaveTextContent("正在执行");
    expect(row).toHaveTextContent(icon.getAttribute("aria-label")!);
    expect(icon).not.toHaveClass("animate-spin");
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "running");
  });
});
