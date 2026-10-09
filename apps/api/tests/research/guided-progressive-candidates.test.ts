import { expect, it, vi } from "vitest";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import { executeTaskPipeline } from "../../src/application/research/guided-task-pipeline";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
const { screen } = vi.hoisted(() => ({ screen: vi.fn() }));
vi.mock("../../src/application/research/guided-source-relevance", async importOriginal => ({
  ...await importOriginal<object>(), screenResearchSources: screen,
}));
function fixture(parent?: AbortSignal) {
  const state: ResearchRuntime = { sessionId: "progressive", version: 1, revision: 0, currentNode: "research", availableNodes: ["research"],
    brief: { topic: "Policy", goal: "Compare", focus: "Evidence", region: "EU", timeRange: "2026" }, directions: [],
    outline: [{ id: "a", title: "Policy", order: 0, enabled: true, questions: ["What applies?"] }],
    tasks: [{ id: "task-a", sectionId: "a", query: "policy", status: "pending", attempts: 0, errorCode: null }],
    sources: [], report: null, busy: true, completed: false, generatedNodes: [], messages: [], modelCalls: [], proposal: null, errorCode: null, leaseUntil: null };
  const snapshots: ResearchRuntime[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { snapshots.push(structuredClone(state)); }, { requestId: "progressive", observe: vi.fn() });
  const hits = Array.from({ length: 10 }, (_, i) => ({ title: `Policy ${i}`, url: `https://example.org/${i}`, content: "Policy evidence" }));
  const read = vi.fn(async () => ({ text: "Policy evidence from the document", contentKind: "text" as const, truncated: false }));
  const search = { search: vi.fn(async () => hits), read };
  const budget = SearchBudget.perCall(90_000, "RESEARCH_SOURCE_MODEL_TIMEOUT", parent);
  const run = () => executeTaskPipeline(state, persist, search, budget, async () => { throw new Error("Unexpected model recovery"); });
  return { state, snapshots, read, search, budget, run };
}
it("stops reading additional search hits after three approved document sources", async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.search.search).toHaveBeenCalledTimes(1);
  expect(f.state.sources).toHaveLength(3);
  expect(f.state.tasks[0]!.status).toBe("succeeded");
});
it("publishes approved sources before a later candidate batch finishes", async () => {
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    entered(); await blocked; return candidates;
  });
  const f = fixture(), execution = f.run();
  try {
    await waiting;
    expect(f.state.sources).toHaveLength(1);
    expect(f.snapshots.some(snapshot => snapshot.sources.length === 1 && snapshot.tasks[0]!.status === "running")).toBe(true);
  } finally { release(); await execution; f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(6);
});
it("retains published approved documents when a later screening batch fails", async () => {
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    throw new Error("provider unavailable");
  });
  const f = fixture();
  try { await expect(f.run()).rejects.toThrow("RESEARCH_SEARCH_PARTIAL_FAILURE"); } finally { f.budget.dispose(); }
  expect(f.state.sources).toHaveLength(1);
  expect(f.state.tasks[0]!.status).toBe("failed");
  expect(f.state.report).toBeNull();
  expect(f.state.completed).toBe(false);
});
it("does not publish a late batch after cancellation, preserving the first approved batch", async () => {
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    entered(); await blocked; return candidates;
  });
  const abort = new AbortController();
  const f = fixture(abort.signal), execution = f.run();
  try {
    await waiting;
    abort.abort(new Error("execution cancelled"));
    release();
    await expect(execution).rejects.toThrow();
    expect(f.state.sources).toHaveLength(1);
    expect(f.state.tasks[0]!.status).not.toBe("succeeded");
  } finally { release(); await execution.catch(() => {}); f.budget.dispose(); }
});
it("does not stop a retry on retained documents when the current window has no approved sources", async () => {
  screen.mockImplementation(async (_state, candidates) => candidates[0].url.endsWith("/0") ? [] : candidates);
  const f = fixture();
  f.state.sources = Array.from({ length: 3 }, (_, i) => ({ id: `old-${i}`, taskId: "task-a", taskIds: ["task-a"], title: "Retained", url: `https://example.org/old-${i}`,
    content: "Earlier evidence", document: { text: "Earlier evidence", contentHash: "a".repeat(64), contentKind: "text" as const, url: `https://example.org/old-${i}`, retrievedAt: "2026-10-09T00:00:00Z", truncated: false }, retrievedAt: "2026-10-09T00:00:00Z", decision: "accepted" as const }));
  // Already fetched sources bypass persisted pending-document work, but must not
  // supply this attempt's stopping count without current relevance validation.
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(6);
  expect(f.state.tasks[0]!.status).toBe("succeeded");
  expect(f.state.tasks[0]!.errorCode).toBeNull();
});
