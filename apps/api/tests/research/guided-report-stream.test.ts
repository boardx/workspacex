import { afterEach, describe, expect, it, vi } from "vitest";
import { streamReport, type RuntimePersistence } from "../../src/application/research/guided-report-stream";
import type { ResearchRuntime, RuntimeStreamEvent } from "../../src/application/research/guided-runtime-ports";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
const input = { modelProvider: "test", modelId: "test", system: "report", user: "{}" };
function fixture() {
  const state: ResearchRuntime = { sessionId: "s", version: 2, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [], outline: [], tasks: [], sources: [], report: null,
    completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
  const events: RuntimeStreamEvent[] = [];
  const writes: ResearchRuntime[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { writes.push(structuredClone(state)); }, { requestId: "r", observe: (event: RuntimeStreamEvent) => { events.push(event); } });
  return { state, events, writes, persist };
}
afterEach(() => vi.useRealTimers());
describe("actual report provider stream persistence", () => {
  it("publishes first delta before provider resolves and flushes trailing tokens on completion", async () => {
    const f = fixture(); let release!: () => void; let first!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { first = resolve; });
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (_, delta) => {
      await delta("first"); first(); await blocked; await delta(" trailing"); return { text: "first trailing" };
    } };
    const running = streamReport(model, input, f.state, f.persist);
    await started;
    expect(f.events.map((event) => event.type)).toEqual(["snapshot", "report_delta"]);
    expect(f.writes.at(-1)?.reportStream?.text).toBe("first");
    release(); expect((await running).text).toBe("first trailing");
    expect(f.writes.at(-1)?.reportStream?.text).toBe("first trailing");
    expect(model.complete).not.toHaveBeenCalled();
  });
  it("flushes buffered deltas within 250ms even when the upstream stalls", async () => {
    vi.useFakeTimers(); const f = fixture(); let release!: () => void; let first!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { first = resolve; });
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (_, delta) => {
      await delta("a"); await delta("b"); first(); await blocked; return { text: "ab" };
    } };
    const running = streamReport(model, input, f.state, f.persist); await started;
    expect(f.state.reportStream?.text).toBe("a");
    await vi.advanceTimersByTimeAsync(250); expect(f.writes.at(-1)?.reportStream?.text).toBe("ab");
    release(); await running;
  });
  it("propagates persistence failure rather than publishing an unpersisted delta", async () => {
    const f = fixture(); const persist = Object.assign(async () => { if (f.state.reportStream?.text) throw new Error("write denied"); }, { requestId: "r", observe: f.persist.observe });
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (_, delta) => { await delta("text"); return { text: "text" }; } };
    await expect(streamReport(model, input, f.state, persist)).rejects.toThrow("write denied");
    expect(f.events.map((event) => event.type)).toEqual(["snapshot"]); expect(f.state.reportStream?.status).toBe("failed");
  });
  it("bounds provider output and never fabricates deltas for a nonstream provider", async () => {
    const f = fixture();
    await streamReport({ complete: async () => ({ text: "complete only" }) }, input, f.state, f.persist);
    expect(f.events.map((event) => event.type)).toEqual(["snapshot"]);
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (_, delta) => { await delta("x".repeat(1048577)); return { text: "" }; } };
    await expect(streamReport(model, input, f.state, f.persist)).rejects.toThrow("RESEARCH_NODE_STATE_INVALID");
  });
});
