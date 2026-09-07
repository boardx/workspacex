import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";

describe("workbench AG-UI relay", () => {
  it("streams text immediately, closes commentary at tool start, and reports a result only at actual completion", () => {
    const wire: { type: EventType; messageId?: string; toolCallId?: string; delta?: string }[] = [];
    const relay = createExecutionJournalRelay((event) => wire.push(event));
    const base = { runId: "run", emittedAt: "2026-09-07T00:00:00Z", attemptId: "attempt" };
    relay.accept({ ...base, seq: 0, kind: "text_delta", messageId: "progress", delta: "Checking" });
    expect(wire.at(-1)).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, delta: "Checking" });
    relay.accept({ ...base, seq: 1, kind: "tool_start", toolCallId: "tool", toolName: "call_skill", args: { name: "research" } });
    expect(wire.some((event) => event.type === EventType.TOOL_CALL_RESULT)).toBe(false);
    expect(wire.filter((event) => event.type !== EventType.CUSTOM).map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END,
    ]);
    relay.accept({ ...base, seq: 2, kind: "tool_end", toolCallId: "tool", toolName: "call_skill", ok: false, result: "Failed" });
    const final: ExecutionEvent = { ...base, seq: 3, kind: "text_delta", messageId: "final", delta: "The result" };
    relay.accept(final);
    expect(wire.at(-1)).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "final", delta: "The result" });
    const beforeReplay = wire.length;
    relay.accept(final);
    expect(wire).toHaveLength(beforeReplay);
    expect(relay.accept({ ...base, seq: 4, kind: "final_message", messageId: "final" })).toEqual({ messageId: "final", sawText: true });
    relay.close(); relay.close();
    expect(wire.filter((event) => event.type === EventType.TEXT_MESSAGE_END && event.messageId === "final")).toHaveLength(1);
  });
});
