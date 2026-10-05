import { scopedSupplementQueries } from "../../src/application/research/guided-supplement-task-scope";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { executeTaskPipeline, type PipelineComplete } from "../../src/application/research/guided-task-pipeline";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import { reportQuestions } from "../../src/application/research/guided-report-evidence";
import { supplementQuery } from "../../src/application/research/guided-supplement-query";
import { ResearchRuntimeError, type ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
function fixture(crossSection = false) {
  const state: ResearchRuntime = { sessionId: "supplement-scope", version: 1, revision: 0, currentNode: "research", availableNodes: ["research"], brief: { topic: "Synthetic grid", goal: "Compare policy", timeRange: "2026", region: "EU", focus: "Policy" }, directions: [],
    outline: crossSection ? [{ id: "one", title: "One", enabled: true, order: 0, questions: ["A policy?"] }, { id: "two", title: "Two", enabled: true, order: 1, questions: ["B policy?", "C policy?"] }]
      : [{ id: "one", title: "One", enabled: true, order: 0, questions: ["A policy?", "B policy?"] }],
    tasks: [], sources: [], report: null, generatedNodes: [], messages: [], modelCalls: [], proposal: null, busy: true, completed: false, errorCode: null, leaseUntil: null };
  const questions = reportQuestions(state.outline);
  state.tasks = questions.map((q, index) => ({ id: `task-${index}`, sectionId: q.sectionId, questionId: q.id, objective: q.question, query: `primary-${index}`, status: "pending", attempts: 0, errorCode: null }));
  const target = questions.at(-1)!, task = state.tasks.at(-1)!, scope = `${state.brief.topic} ${state.brief.region}`;
  const targetQuery = () => supplementQuery(scope, state.outline.find(section => section.id === target.sectionId)!.questions.at(-1)!);
  const targetUrl = "https://example.org/target-supplement";
  const primary = new Map(state.tasks.map((task, index) => [task.query, { url: `https://example.org/primary-${index}`, questionId: task.questionId! }]));
  const documents = new Map([...primary.values()].map(value => [value.url, `Original synthetic policy evidence for ${value.questionId}.`]));
  documents.set(targetUrl, `Additional synthetic evidence for ${target.id}.`);
  const scans: { url: string; taskId: string; questionIds: string[] }[] = [], writes: ResearchRuntime[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { writes.push(structuredClone(state)); }, { requestId: "controlled", observe: () => {} });
  const complete: PipelineComplete = async (_system, context, validate, _admit, check) => {
    check();
    if ((context as { researchStage?: string }).researchStage === "search_recovery") throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
    const c = context as { chunks: { url: string; sourceId: string; chunkId: string; taskId: string; questionIds: string[]; quoteOptions: { quoteRef: string }[] }[] };
    const output = { evaluations: c.chunks.map(chunk => {
      scans.push({ url: chunk.url, taskId: chunk.taskId, questionIds: chunk.questionIds });
      const expected = chunk.url === targetUrl ? target.id : [...primary.values()].find(value => value.url === chunk.url)!.questionId;
      const valid = chunk.questionIds.includes(expected);
      return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !valid,
        matches: valid ? [{ questionId: expected, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Controlled exact-question evidence", relevance: "direct" }] : [] };
    }) }; validate(output); return output;
  };
  const search = vi.fn(async (query: string) => {
    const hit = primary.get(query), url = hit?.url ?? (query === targetQuery() ? targetUrl : undefined);
    return url ? [{ title: "Synthetic policy page", url, content: documents.get(url)! }] : [];
  });
  const run = async () => {
    const budget = SearchBudget.perCall();
    try { await executeTaskPipeline(state, persist, { search, read: async url => ({ text: documents.get(url)!, contentKind: "text", truncated: false }) }, budget, complete); }
    finally { budget.dispose(); }
  };
  return { state, task, target, targetQuery, targetUrl, scans, search, writes, primary, run };
}
it.each([false, true])("binds a sibling supplement to its exact task without crossing sections (crossSection=%s)", async crossSection => {
  const f = fixture(crossSection); await f.run();
  expect(f.scans.find(scan => scan.url === f.targetUrl)).toEqual({ url: f.targetUrl, taskId: f.task.id, questionIds: [f.target.id] });
  const source = f.state.sources.find(source => source.url === f.targetUrl)!;
  expect(source).toBeDefined(); expect(source.taskId).toBe(f.task.id); expect(source.taskIds).toEqual([f.task.id]);
  const attempt = f.task.searchAttempts!.find(attempt => attempt.query === f.targetQuery());
  expect(attempt).toMatchObject({ status: "succeeded", errorCode: null });
  expect(f.state.tasks[0]!.searchAttempts!.some(attempt => attempt.query === f.targetQuery())).toBe(false);
  expect(f.state.tasks.every(task => task.status === "succeeded")).toBe(true);
  expect(f.writes.flatMap(state => state.sources).filter(source => source.url === f.targetUrl).every(source => source.taskIds!.includes(f.task.id))).toBe(true);
  expect(createHash("sha256").update(source.document!.text).digest("hex")).toBe(source.document!.contentHash);
});
it.each(["missing", "changed-question", "other-section"])("does not guess a question/task binding when %s", async mode => {
  const f = fixture();
  if (mode === "missing") f.state.tasks.pop();
  if (mode === "changed-question") f.state.outline[0]!.questions[1] = "A newly confirmed different question?";
  if (mode === "other-section") f.task.sectionId = "unrelated-section";
  // A failed/missing primary for the altered fixture need not run again; this
  // case isolates dispatch of supplements over persisted successful tasks.
  f.state.tasks.forEach(task => { task.status = "succeeded"; });
  await f.run();
  expect(f.search.mock.calls.some(([query]) => query === f.targetQuery())).toBe(false);
  expect(f.scans.some(scan => scan.url === f.targetUrl)).toBe(false);
  expect(f.state.sources.some(source => source.url === f.targetUrl)).toBe(false);
});
it("does not replay a sibling's already successful identical primary query under the first task", async () => {
  const f = fixture(), original = f.task.query; f.task.query = f.targetQuery();
  const hit = f.primary.get(original)!; f.primary.delete(original); f.primary.set(f.task.query, hit);
  await f.run();
  expect(f.search.mock.calls.filter(([query]) => query === f.targetQuery())).toHaveLength(1);
  expect(f.state.tasks[0]!.searchAttempts!.some(attempt => attempt.query === f.targetQuery())).toBe(false);
});

it("preserves legacy chapter-wide tasks without inventing a per-question association", async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[0]!]; delete f.state.tasks[0]!.questionId;
  await f.run();
  expect(f.scans.find(scan => scan.url === f.targetUrl)).toEqual({ url: f.targetUrl, taskId: f.state.tasks[0]!.id, questionIds: ["chapter:0/question:0", "chapter:0/question:1"] });
  expect(f.state.sources.find(source => source.url === f.targetUrl)?.taskIds).toEqual([f.state.tasks[0]!.id]);
  expect(f.state.tasks[0]!.status).toBe("succeeded");
});
it("does not claim a truncated objective proves a full long question or its changed tail", () => {
  const f = fixture(), prefix = "Long confirmed question ".repeat(100).slice(0, 2000);
  f.state.outline[0]!.questions = ["A policy?"];
  f.state.outline[0]!.subsections = [{ id: "long", title: "Long question", questions: [prefix + " original tail"] }];
  f.task.objective = prefix;
  for (const tail of [" original tail", " changed tail"]) {
    f.state.outline[0]!.subsections[0]!.questions[0] = prefix + tail;
    const derived = scopedSupplementQueries(f.state, f.state.outline[0]!, [f.task, f.state.tasks[0]!]);
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every(entry => entry.task.id !== f.task.id)).toBe(true);
  }
});
it("keeps each selected task's durable attempt limit and does not spend sibling work on an exhausted task", async () => {
  const f = fixture(); f.state.tasks.forEach(task => { task.status = "succeeded"; });
  f.state.tasks[0]!.searchAttempts = Array.from({ length: 12 }, (_, index) => ({ query: `old-${index}`, status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY" }));
  await f.run();
  expect(f.state.tasks[0]!.searchAttempts).toHaveLength(12);
  expect(f.task.searchAttempts!.find(attempt => attempt.query === f.targetQuery())).toMatchObject({ status: "succeeded", errorCode: null });
  expect(f.state.sources.find(source => source.url === f.targetUrl)?.taskIds).toEqual([f.task.id]);
});

it("does not convert a failed primary task into success when its correctly scoped supplement succeeds", async () => {
  const f = fixture(); f.task.status = "failed"; f.task.errorCode = "RESEARCH_SEARCH_NO_RELEVANT_SOURCES";
  f.task.searchAttempts = [{ query: f.task.query, status: "failed", errorCode: f.task.errorCode }];
  await expect(f.run()).rejects.toThrow("RESEARCH_SEARCH_PARTIAL_FAILURE");
  expect(f.task.status).toBe("failed");
  expect(f.task.searchAttempts.find(attempt => attempt.query === f.targetQuery())).toMatchObject({ status: "succeeded", errorCode: null });
  expect(f.state.sources.find(source => source.url === f.targetUrl)?.taskIds).toEqual([f.task.id]);
  expect(f.state.report).toBeNull(); expect(f.state.completed).toBe(false);
});

it("keeps identical question wording in different sections bound to distinct question/task identities", async () => {
  const f = fixture(true); f.state.outline[0]!.questions[0] = f.target.question;
  f.state.tasks[0]!.objective = f.target.question;
  await f.run();
  const scopes = f.scans.filter(scan => scan.url === f.targetUrl);
  expect(scopes).toHaveLength(2);
  expect(scopes.map(scan => `${scan.taskId}:${scan.questionIds.join()}`).sort()).toEqual([
    `${f.state.tasks[0]!.id}:chapter:0/question:0`, `${f.task.id}:${f.target.id}`,
  ].sort());
  expect(f.state.sources.find(source => source.url === f.targetUrl)?.taskIds).toEqual([f.task.id]);
});
it("does not assign either specific or broad supplements to an ambiguous question task", async () => {
  const f = fixture(); const first = f.state.tasks[0]!;
  const duplicate = { ...first, id: "conflicting-task" }; f.state.tasks.unshift(duplicate);
  f.state.tasks.forEach(task => { task.status = "succeeded"; });
  const plan = scopedSupplementQueries(f.state, f.state.outline[0]!, f.state.tasks);
  expect(plan.length).toBeGreaterThan(0);
  expect(plan.every(entry => entry.task.id !== first.id && entry.task.id !== duplicate.id)).toBe(true);
  await f.run();
  expect(first.searchAttempts ?? []).toEqual([]); expect(duplicate.searchAttempts ?? []).toEqual([]);
  expect(f.task.searchAttempts!.find(attempt => attempt.query === f.targetQuery())).toMatchObject({ status: "succeeded" });
});
