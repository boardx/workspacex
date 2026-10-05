import { expect, it, vi } from "vitest";
import { executeTaskPipeline, type PipelineComplete } from "../../src/application/research/guided-task-pipeline";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import type { ResearchRuntime, GuidedSearchPort } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
const queries = ["grid policy original", "grid policy recovery one", "grid policy recovery two"];
function fixture() {
  const state: ResearchRuntime = { sessionId: "negative-pipeline", version: 3, revision: 0, currentNode: "research", availableNodes: ["research"],
    brief: { topic: "Grid policy", goal: "Compare public regulation", region: "EU", focus: "Policy", timeRange: "2026" }, directions: [],
    outline: [{ id: "section", title: "Regulation", enabled: true, order: 0, questions: ["What policy applies?"] }],
    tasks: [{ id: "task", sectionId: "section", questionId: "chapter:0/question:0", query: queries[0]!, status: "pending", attempts: 0, errorCode: null }],
    sources: [], report: null, generatedNodes: [], messages: [], modelCalls: [], proposal: null, busy: true, completed: false, errorCode: null, leaseUntil: null };
  const writes: ResearchRuntime[] = [], events: unknown[] = [], screening: any[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { writes.push(structuredClone(state)); }, { requestId: "controlled-execution", observe: (event: unknown) => { events.push(event); } });
  const search: GuidedSearchPort = { search: vi.fn(async query => queries.includes(query) ? [{ title: "Public synthetic page", url: "https://example.org/page", content: "Unrelated public discovery excerpt" }] : []),
    read: vi.fn(async () => ({ text: "Unrelated publicly synthetic material. ".repeat(2000).slice(0, 60000), contentKind: "text" as const, truncated: false })) };
  const complete: PipelineComplete = vi.fn(async (_system, context, validate, admit, check) => {
    check();
    const input = context as { researchStage: string; chunks?: { sourceId: string; chunkId: string }[] };
    const output = input.researchStage === "search_recovery" ? { queries: queries.slice(1) } : { evaluations: input.chunks!.map(chunk => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: true, matches: [] })) };
    const call = { id: String(state.modelCalls.length), node: "research" as const, modelId: "controlled", status: "failed" as "failed" | "succeeded", createdAt: "controlled" };
    await admit(async () => { state.modelCalls.push(call); await persist(); });
    validate(output); check();
    await admit(async () => { call.status = "succeeded"; });
    if (input.researchStage === "source_relevance") screening.push(structuredClone(input));
    return output;
  });
  const run = async () => {
    const budget = SearchBudget.perCall();
    try { await expect(executeTaskPipeline(state, persist, search, budget, complete)).rejects.toThrow("RESEARCH_SEARCH_PARTIAL_FAILURE"); }
    finally { budget.dispose(); }
  };
  return { state, writes, events, screening, search, run };
}
it("does not rescreen an identical negative page returned by three real pipeline queries", async () => {
  const f = fixture(); await f.run();
  const issued = vi.mocked(f.search.search).mock.calls.map(call => call[0]);
  expect(issued.filter(query => queries.includes(query))).toEqual(queries);
  expect(f.search.read).toHaveBeenCalledTimes(1);
  expect(f.screening).toHaveLength(4);
  expect(f.screening.map(input => input.chunks.length)).toEqual([1, 2, 4, 3]);
  expect(f.state.tasks[0]).toMatchObject({ status: "failed", errorCode: "RESEARCH_SEARCH_NO_RELEVANT_SOURCES", questionId: "chapter:0/question:0", attempts: 1 });
  expect(f.state.tasks[0]!.searchAttempts!.slice(0, 3)).toEqual(queries.map(query => ({ query, status: "failed", errorCode: "RESEARCH_SEARCH_NO_RELEVANT_SOURCES" })));
  expect(f.state.sources).toEqual([]); expect(f.state.report).toBeNull(); expect(f.state.completed).toBe(false);
  expect(f.writes.every(state => state.sources.length === 0)).toBe(true);
});
it("requires a complete fresh scan again in a new pipeline execution", async () => {
  const first = fixture(); await first.run();
  const next = fixture(); next.state.version = first.state.version + 1; await next.run();
  expect(first.screening).toHaveLength(4); expect(next.screening).toHaveLength(4);
  expect(next.state.tasks.map(task => ({ status: task.status, questionId: task.questionId, errorCode: task.errorCode })))
    .toEqual(first.state.tasks.map(task => ({ status: task.status, questionId: task.questionId, errorCode: task.errorCode })));
  expect(next.state.sources).toEqual(first.state.sources);
});
