import { describe, it, expect } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { reduceTrace, traceEntries, progressMessageIds } from "@/lib/chat-workbench/run-trace";
const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const text = (seq: number, delta: string, messageId = "progress"): ExecutionEvent => ({ ...base, seq, kind: "text_delta", messageId, delta });
const start: ExecutionEvent = { ...base, seq: 2, kind: "tool_start", toolCallId: "call-1", toolName: "call_skill", args: { skill_stable_name: "research" } };
describe("durable run trace", () => {
  it("replaces legacy projections with the real journal and ignores late legacy responses", () => {
    const legacy: ExecutionEvent = { ...text(0, "旧记录"), source: "legacy" };
    const initial = reduceTrace({}, [legacy]);
    const current = reduceTrace(initial, [text(0, "真实事件")]);
    expect(current["run-1"]).toEqual([text(0, "真实事件")]);
    expect(reduceTrace(current, [legacy])).toBe(current);
  });
  it("replays 1000 activities across 50 runs once and preserves identity for duplicate batches", () => {
    const events = Array.from({ length: 1000 }, (_, index) => ({ ...text(index % 20, String(index)), runId: `run-${Math.floor(index / 20)}` }));
    const state = reduceTrace({}, [...events].reverse());
    expect(Object.keys(state)).toHaveLength(50);
    expect(Object.values(state).every((run) => run.length === 20 && run.every((event, index) => event.seq === index))).toBe(true);
    expect(reduceTrace(state, events)).toBe(state);
  });
  it("replays shuffled events without duplicating deltas or crossing runs", () => {
    const state = reduceTrace({}, [start, text(1, "资料"), text(0, "查阅")]);
    const replay = reduceTrace(state, [text(0, "查阅"), text(1, "资料")]);
    expect(replay["run-1"]).toHaveLength(3);
    expect(traceEntries(replay["run-1"]!)[0]!.text).toBe("查阅资料");
    expect(reduceTrace(replay, [{ ...text(0, "别的任务"), runId: "run-2" }])["run-2"]).toHaveLength(1);
  });
  it("keeps unclassified streaming answer outside the trace and classifies progress by tool boundary", () => {
    expect(traceEntries([text(0, "查询中")])).toEqual([]);
    expect(progressMessageIds([text(0, "查询中"), start]).has("progress")).toBe(true);
    const events: ExecutionEvent[] = [text(0, "查询中"), start, text(3, "答案", "answer"), { ...base, seq: 4, kind: "final_message", messageId: "answer" }];
    expect(traceEntries(events).map((entry) => entry.text)).toEqual(["查询中", "research"]);
  });
  it("updates skill result with genuine failure without treating start as success", () => {
    expect(traceEntries([start])[0]!.status).toBe("running");
    const end: ExecutionEvent = { ...base, seq: 3, kind: "tool_end", toolCallId: "call-1", toolName: "call_skill", result: "unavailable", ok: false };
    expect(traceEntries([start, end])[0]).toMatchObject({ kind: "skill", status: "failed", result: "unavailable" });
  });
});
