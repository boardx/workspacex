import { expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { toOrgId } from "../../src/domain/org-id";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
import { runAguiBridgeTurn, type AguiBridgeDeps } from "../../src/application/agent-run/agui-bridge";

const { readRun, acceptMessage, listMessages } = vi.hoisted(() => ({
  readRun: vi.fn(), acceptMessage: vi.fn(), listMessages: vi.fn(),
}));
vi.mock("../../src/application/agent-run/read-run", async importOriginal => ({
  ...await importOriginal<object>(), readAgentRun: readRun,
}));
vi.mock("../../src/application/chat/message-roundtrip", async importOriginal => ({
  ...await importOriginal<object>(), acceptHumanMessage: acceptMessage, listMessagePage: listMessages,
}));

async function drive(status: "succeeded" | "failed" = "succeeded", journal = true) {
  readRun.mockReset(); acceptMessage.mockReset(); listMessages.mockReset();
  const args = JSON.stringify({ todos: [{ content: "持久计划", status: "pending" }] });
  const step = { kind: "tool_call", toolName: "write_todos", toolArgsSummary: args, toolResultSummary: "ok", planningNote: null };
  readRun.mockResolvedValueOnce({ status: "running", steps: [{ ...step, status: "in_progress" }] })
    .mockResolvedValueOnce({ status: "running", steps: [{ ...step, status }] })
    .mockResolvedValueOnce({ status: "succeeded", resultMessageId: "persisted", steps: [{ ...step, status }] });
  acceptMessage.mockResolvedValue({ agentRunId: "run", reused: false });
  listMessages.mockResolvedValue({ messages: [{ id: "persisted", text: "done" }] });
  const event = (seq: number, value: object) => ({ runId: "run", seq, emittedAt: new Date(0).toISOString(), ...value } as ExecutionEvent);
  const readExecutionEvents = vi.fn()
    .mockResolvedValueOnce([event(0, { kind: "tool_start", toolCallId: "call", toolName: "write_todos", args: {} })])
    .mockResolvedValueOnce([event(1, { kind: "tool_end", toolCallId: "call", toolName: "write_todos", result: "ok", ok: status === "succeeded" })])
    .mockResolvedValue([]);
  const wire: Array<{ type: EventType; snapshot?: unknown }> = [];
  const relay = createExecutionJournalRelay(value => wire.push(value));
  const onStep = vi.fn(step => relay.acceptPlanStep(step));
  const outcome = await runAguiBridgeTurn({ runs: journal ? { readExecutionEvents } : {} } as unknown as AguiBridgeDeps, {
    userId: "actor", orgId: toOrgId("org-plan-progression"), agentId: "agent", threadId: "thread",
    clientMessageId: "client", text: "plan", pollIntervalMs: 1, maxPolls: 4,
    onExecutionEvent: event => { relay.accept(event); }, onStep,
  });
  expect(outcome.kind).toBe("succeeded");
  return { wire, onStep };
}

it("refreshes a folded write_todos completion once, after its real journal result", async () => {
  const { wire, onStep } = await drive();
  expect(onStep.mock.calls.map(([step]) => step.status)).toEqual(["in_progress", "succeeded"]);
  expect(wire.filter(event => event.type === EventType.STATE_SNAPSHOT)).toEqual([
    { type: EventType.STATE_SNAPSHOT, snapshot: { todos: [{ content: "持久计划", status: "pending" }] } },
  ]);
  expect(wire.findIndex(event => event.type === EventType.STATE_SNAPSHOT))
    .toBeGreaterThan(wire.findIndex(event => event.type === EventType.TOOL_CALL_RESULT));
});

it("reports a failed folded plan once but never fabricates a successful snapshot", async () => {
  const { wire, onStep } = await drive("failed");
  expect(onStep.mock.calls.map(([step]) => step.status)).toEqual(["in_progress", "failed"]);
  expect(wire.filter(event => event.type === EventType.STATE_SNAPSHOT)).toHaveLength(0);
});

it("does not reannounce legacy tool envelopes when journal transport is absent", async () => {
  const { onStep } = await drive("succeeded", false);
  expect(onStep.mock.calls.map(([step]) => step.status)).toEqual(["in_progress"]);
});
