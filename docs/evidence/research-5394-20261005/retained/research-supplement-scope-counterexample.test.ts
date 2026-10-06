import { expect, it } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/node_modules/vitest/dist/index.js";
import { createHash } from "node:crypto";
import { executeTaskPipeline, type PipelineComplete } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/src/application/research/guided-task-pipeline";
import { screenResearchSources } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/src/application/research/guided-source-relevance";
import { SearchBudget } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/src/application/research/guided-search-budget";
import type { ResearchRuntime } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "/Users/shenyangjun/.codex/worktrees/research-5056-fixes/workspacex/apps/api/src/application/research/guided-report-stream";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
it("demonstrates sibling supplement evaluated under first task rather than its own exact question", async () => {
  const state: ResearchRuntime = { sessionId: "public-controlled-scope", version: 1, revision: 0, currentNode: "research", availableNodes: ["research"], brief: { topic: "Synthetic grid", goal: "Compare A and B policy", timeRange: "2026", region: "EU", focus: "Policy" }, directions: [],
    outline: [{ id: "section", title: "Public synthetic policy", enabled: true, order: 0, questions: ["FIRST-A-QUESTION?", "SIBLING-B-QUESTION?"] }],
    tasks: ["A", "B"].map((id, i) => ({ id: `task-${id}`, sectionId: "section", questionId: `chapter:0/question:${i}`, query: `primary-${id}`, objective: `${id} evidence`, status: "pending", attempts: 0, errorCode: null })),
    sources: [], report: null, generatedNodes: [], messages: [], modelCalls: [], proposal: null, busy: true, completed: false, errorCode: null, leaseUntil: null };
  const issued: string[] = [], calls: unknown[] = [];
  const urls = { A: "https://example.org/primary-A", B: "https://example.org/primary-B", sibling: "https://example.org/sibling-B" };
  const documents = new Map([[urls.A, "Verified synthetic A-only policy fact."], [urls.B, "Verified synthetic B-only policy fact."], [urls.sibling, "Verified synthetic B-only supplemental policy fact."]]);
  const evaluate = (context: any) => {
    calls.push({ stage: context.researchStage, scopes: context.chunks.map((c: any) => ({ url: c.url, taskId: c.taskId, questionIds: c.questionIds })) });
    return { evaluations: context.chunks.map((chunk: any) => {
      const text = documents.get(chunk.url)!;
      const expectedQuestion = text.includes("A-only") ? "chapter:0/question:0" : "chapter:0/question:1";
      const allowed = chunk.questionIds.includes(expectedQuestion);
      return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !allowed,
        matches: allowed ? [{ questionId: expectedQuestion, quoteRef: chunk.quoteOptions[0].quoteRef, insight: "Controlled exact-question synthetic evidence", relevance: "direct" }] : [] };
    }) };
  };
  const complete: PipelineComplete = async (_system, context, validate, _admit, check) => { check(); const value = evaluate(context); validate(value); return value; };
  const persist: RuntimePersistence = Object.assign(async () => {}, { requestId: "controlled", observe: () => {} });
  const budget = SearchBudget.perCall();
  try {
    await executeTaskPipeline(state, persist, {
      search: async query => {
        issued.push(query);
        const url = query === "primary-A" ? urls.A : query === "primary-B" ? urls.B : query.includes("SIBLING-B-QUESTION?") ? urls.sibling : undefined;
        return url ? [{ title: "Public synthetic policy page", url, content: documents.get(url)! }] : [];
      }, read: async url => ({ text: documents.get(url)!, contentKind: "text", truncated: false }),
    }, budget, complete);
  } finally { budget.dispose(); }
  const siblingQuery = issued.find(query => query.includes("SIBLING-B-QUESTION?"))!;
  const actualAttempt = state.tasks[0]!.searchAttempts!.find(attempt => attempt.query === siblingQuery)!;
  const supplied = calls.flatMap((call: any) => call.scopes).find(scope => scope.url === urls.sibling);
  expect(siblingQuery).toBeDefined(); expect(actualAttempt).toMatchObject({ status: "failed", errorCode: "RESEARCH_SEARCH_NO_RELEVANT_SOURCES" });
  expect(supplied).toEqual({ url: urls.sibling, taskId: "task-A", questionIds: ["chapter:0/question:0"] });
  expect(state.sources.some(source => source.url === urls.sibling)).toBe(false);
  const body = documents.get(urls.sibling)!;
  const correct = await screenResearchSources(state, [{ id: "controlled-correct-task", taskId: "task-B", taskIds: ["task-B"], title: "Public synthetic policy page", url: urls.sibling, content: body, retrievedAt: "controlled", decision: "accepted",
    document: { url: urls.sibling, text: body, contentHash: hash(body), retrievedAt: "controlled", contentKind: "text", truncated: false } }],
    async (_system, context, validate) => { const value = evaluate(context); validate(value); return value; }, { adaptive: true });
  expect(correct).toHaveLength(1); expect(correct[0]!.taskIds).toEqual(["task-B"]);
  console.log(JSON.stringify({ controlledOnly: true, siblingQuery, actualScope: supplied, actualAttempt, siblingSourcePublished: false,
    primaryTasks: state.tasks.map(task => ({ id: task.id, status: task.status, errorCode: task.errorCode })), correctTaskAccepted: correct[0]!.taskIds, screeningCalls: calls.length }));
});
