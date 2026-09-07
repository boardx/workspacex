import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries, reduceTrace } from "@/lib/chat-workbench/run-trace";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "r", attemptId: "r:1", emittedAt: "2026-09-07T00:00:00Z" };
const identity = { contractVersion: 1 as const, skillId: "skill-id", skillStableName: "report", skillVersion: "version-id", packageDigest: "a".repeat(64) };
const read: ExecutionEvent = { ...base, seq: 1, kind: "skill_activity", fact: { ...identity, factId: "read", stage: "body_read", readPath: "/skills/report/SKILL.md" } };

it("displays reading as an observed fact, never a successful execution or a fabricated tool call", () => {
  const toolRenderer = vi.fn();
  render(<RunTracePanel runId="r" events={[read]} renderTool={toolRenderer} />);
  expect(screen.getByTestId("run-trace-body")).not.toBeVisible();
  fireEvent.click(screen.getByTestId("run-trace-toggle"));
  expect(screen.getByText("读取技能正文 · report")).toBeVisible();
  expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "observed");
  expect(screen.queryByLabelText("执行成功")).toBeNull();
  expect(toolRenderer).not.toHaveBeenCalled();
});

it("replays facts once and merges an execution by actual skill version and ToolCall identity", () => {
  const started: ExecutionEvent = { ...base, seq: 2, kind: "skill_activity", fact: { ...identity, factId: "start", stage: "execution_started", toolCallId: "call" } };
  const done: ExecutionEvent = { ...base, attemptId: "r:4", seq: 3, kind: "skill_activity", fact: { ...identity, factId: "done", stage: "execution_succeeded", toolCallId: "call" } };
  const store = reduceTrace({}, [read, started, done]);
  expect(reduceTrace(store, [read, started, done])).toBe(store);
  const entries = traceEntries(store.r!);
  expect(entries).toHaveLength(2);
  expect(entries[0]?.status).toBe("observed");
  expect(entries[1]).toMatchObject({ status: "succeeded", activityStage: "execution_succeeded", attemptIds: ["r:1", "r:4"] });
});

it("merges approval replay by source call ID while preserving distinct same-name calls", () => {
  const events: ExecutionEvent[] = [
    { ...base, seq: 0, kind: "tool_start", toolCallId: "r:1:call", sourceToolCallId: "call", toolName: "call_skill", args: { skill_stable_name: "report" } },
    { ...base, attemptId: "r:4", seq: 1, kind: "tool_start", toolCallId: "r:4:call", sourceToolCallId: "call", toolName: "call_skill", args: { skill_stable_name: "report" } },
    { ...base, attemptId: "r:4", seq: 2, kind: "tool_end", toolCallId: "r:4:call", sourceToolCallId: "call", toolName: "call_skill", ok: true, result: "ok" },
    { ...base, attemptId: "r:4", seq: 3, kind: "tool_start", toolCallId: "r:4:another", sourceToolCallId: "another", toolName: "call_skill", args: { skill_stable_name: "report" } },
  ];
  expect(traceEntries(events)).toHaveLength(2);
  expect(traceEntries(events)[0]).toMatchObject({ status: "succeeded", attemptIds: ["r:1", "r:4"] });
});
