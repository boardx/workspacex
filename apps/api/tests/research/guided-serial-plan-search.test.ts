import { describe, expect, it, vi } from "vitest";
import { executeTaskPipeline, type PipelineComplete } from "../../src/application/research/guided-task-pipeline";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import { ResearchRuntimeError, type ResearchRuntime, type GuidedSearchPort } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
function fixture(phase: "primary" | "recovery" | "supplement", parent?: AbortSignal) {
  const state: ResearchRuntime = { sessionId: "serial-plan", version: 1, revision: 0, currentNode: "research", availableNodes: ["research"],
    brief: { topic: "Public policy", goal: "Compare", focus: "Evidence", region: "EU", timeRange: "2026" }, directions: [],
    outline: ["a", "b"].map((id, order) => ({ id, title: `${id} scope`, order, enabled: true, questions: [`What does ${id} require?`] })),
    tasks: ["a", "b"].map(id => ({ id: `task-${id}`, sectionId: id, query: `${id} primary`, status: "pending", attempts: 0, errorCode: null })),
    sources: [], report: null, busy: true, completed: false, generatedNodes: [], messages: [], modelCalls: [], proposal: null, errorCode: null, leaseUntil: null };
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const calls: string[] = [], snapshots: ResearchRuntime[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { snapshots.push(structuredClone(state)); }, { requestId: "fixture", observe: vi.fn() });
  const wait = async () => { started(); await blocked; };
  const search: GuidedSearchPort = { search: vi.fn(async query => {
    calls.push(query);
    if (phase === "primary" && query === "a primary") await wait();
    if (phase === "recovery" && query === "a primary") return [];
    if (phase === "supplement" && query.includes("a primary") && query.includes("primary source")) await wait();
    throw new Error("controlled unavailable search");
  }), ...(phase === "supplement" ? { read: vi.fn(async () => ({ text: "Public material", contentKind: "text" as const, truncated: false })) } : {}) };
  const complete: PipelineComplete = async (_system, context, validate, _admit, check) => {
    check(); const input = context as { researchStage: string; task: { sectionId: string } };
    expect(input.researchStage).toBe("search_recovery");
    if (phase === "recovery" && input.task.sectionId === "a") await wait();
    check(); const output = { queries: ["a revised public regulation"] }; validate(output); return output;
  };
  const budget = SearchBudget.perCall(90_000, "RESEARCH_SOURCE_MODEL_TIMEOUT", parent);
  const run = () => executeTaskPipeline(state, persist, search, budget, complete).then(() => null, error => error);
  return { state, calls, snapshots, search, budget, run, entered, release: () => release() };
}
describe("confirmed plan section execution boundaries", () => {
  it.each(["primary", "recovery", "supplement"] as const)("does not enter a later section while its predecessor %s is unsettled", async phase => {
    const f = fixture(phase), execution = f.run();
    try {
      await f.entered; await new Promise<void>(resolve => setImmediate(resolve));
      expect(f.calls).not.toContain("b primary");
      expect(f.state.tasks[1]!.status).toBe("pending");
    } finally { f.release(); await execution; f.budget.dispose(); }
    const result = await execution;
    expect(result.reasonCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(f.calls).toContain("b primary");
    expect(f.state.tasks.every(task => task.status === "failed")).toBe(true);
    expect(f.snapshots.some(state => state.tasks[0]!.status === "failed" && state.tasks[1]!.status === "pending")).toBe(true);
    expect(f.state.tasks.every(task => task.searchAttempts?.every(attempt => attempt.status !== "running"))).toBe(true);
  });
});

it("retains stable duplicate-order, empty, disabled and unknown section task groups without dropping work", async () => {
  const f = fixture("primary"); f.release();
  f.state.outline = [
    { id: "b", title: "B", order: 1, enabled: true, questions: ["B?"] },
    { id: "a", title: "A", order: 1, enabled: true, questions: ["A?"] },
    { id: "empty", title: "Empty", order: 0, enabled: true, questions: ["Empty?"] },
    { id: "disabled", title: "Disabled", order: 2, enabled: false, questions: ["Disabled?"] },
  ];
  const task = f.state.tasks[0]!;
  f.state.tasks = [["unknown", "x1"], ["a", "a"], ["other-unknown", "y"], ["b", "b"], ["unknown", "x2"], ["disabled", "disabled"]].map(([sectionId, id]) => ({ ...task, sectionId: sectionId!, id: id!, query: `${id} primary` }));
  try { expect((await f.run()).reasonCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); } finally { f.budget.dispose(); }
  expect(f.calls).toEqual(["b primary", "a primary", "disabled primary", "x1 primary", "x2 primary", "y primary"]);
  expect(f.state.tasks.every(task => task.attempts === 1 && task.status === "failed")).toBe(true);
});
it("keeps the original parallel primary slots inside one section", async () => {
  const f = fixture("primary"), first = f.state.tasks[0]!;
  f.state.tasks = [0, 1, 2].map(index => ({ ...first, id: `a-${index}` })).concat([f.state.tasks[1]!]);
  const execution = f.run();
  try {
    await f.entered; await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.calls).toEqual(["a primary", "a primary"]);
    expect(f.state.tasks[3]!.status).toBe("pending");
  } finally { f.release(); await execution; f.budget.dispose(); }
  expect(f.calls).toEqual(["a primary", "a primary", "a primary", "b primary"]);
});
it("skips trusted successful tasks on retry without changing attempt counts", async () => {
  const f = fixture("primary"); f.release();
  f.state.tasks[0]!.status = "succeeded"; f.state.tasks[0]!.attempts = 4;
  try { expect((await f.run()).reasonCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); } finally { f.budget.dispose(); }
  expect(f.calls).toEqual(["b primary"]); expect(f.state.tasks[0]!.attempts).toBe(4); expect(f.state.tasks[0]!.status).toBe("succeeded");
});
it("aborts before later sections and discards late search results without terminal writes", async () => {
  const abort = new AbortController(), f = fixture("primary", abort.signal), execution = f.run();
  try {
    await f.entered;
    const reason = new ResearchRuntimeError("RESEARCH_EXECUTION_INTERRUPTED"); abort.abort(reason);
    expect(await execution).toBe(reason);
    const writes = f.snapshots.length;
    expect(f.calls).toEqual(["a primary"]); expect(f.state.tasks[1]!.status).toBe("pending");
    f.release(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.snapshots).toHaveLength(writes); expect(f.calls).toEqual(["a primary"]);
  } finally { f.release(); await execution; f.budget.dispose(); }
});
