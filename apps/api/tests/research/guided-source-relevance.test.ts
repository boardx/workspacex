import { tasksFromConfirmedQuestions } from "../../src/application/research/guided-task-pipeline";
import { reportQuestions } from "../../src/application/research/guided-report-evidence";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import * as relevanceModule from "../../src/application/research/guided-source-relevance";
import { screenResearchSources } from "../../src/application/research/guided-source-relevance";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type ResearchRuntime, type GuidedRuntimeStore } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";

const session = C.GuidedResearchSession.parse({ sessionId: "relevance-session", title: "王者荣耀", brief: { topic: "王者荣耀综合研究", goal: "市场地位与电竞生态", region: "中国", focus: "用户留存和电竞", timeRange: "2023–2027" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
function runtime() {
  const state = initialRuntime(session);
  state.currentNode = "research";
  state.availableNodes = ["brief", "directions", "outline", "research"];
  state.outline = [{ id: "esports", title: "电竞生态", questions: ["王者荣耀的电竞商业模式及竞品差异是什么？"], enabled: true, order: 0 }];
  state.tasks = [{ id: "task", sectionId: "esports", query: "王者荣耀 KPL 商业模式", status: "pending", attempts: 0, errorCode: null }];
  return state;
}
function source(id: string, content: string): ResearchRuntime["sources"][number] {
  return { id, taskId: "task", title: id, url: `https://example.org/${id}`, content, retrievedAt: "now", decision: "accepted" };
}
const direct = source("kpl", "王者荣耀职业联赛 KPL 的商业收入来自赛事赞助及版权。");
const context = source("competitor", "作为移动电竞对照，Mobile Legends 赛事采用地区联赛及赞助模式。");
const car = source("acura", "Search Inventory: Acura vehicles available at local dealers.");
type Input = { chunks: { sourceId: string; chunkId: string; taskId: string; questionIds: string[]; content?: string; quoteOptions: { text: string; quoteRef: string }[] }[]; questions: { id: string; sectionId: string }[] };
function chunkText(chunk: Input["chunks"][number]) { return chunk.content ?? chunk.quoteOptions.map((option) => option.text).join(" "); }
function evaluation(input: Input) {
  return { evaluations: input.chunks.map((chunk) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId,
    irrelevant: chunkText(chunk) === car.content, matches: chunkText(chunk) === car.content ? [] : [{ questionId: chunk.questionIds[0]!,
      quote: chunk.quoteOptions[0]!.text.slice(0, 300), insight: "控制模型夹具：摘录支持对应的电竞商业模式比较。", relevance: chunkText(chunk) === context.content ? "context" : "direct" }] })) };
}
function complete() {
  return vi.fn(async (_system: string, input: unknown, validate: (output: unknown) => void) => { const output = evaluation(input as Input); validate(output); return output; });
}

describe("automatic research source relevance", () => {
  it("persists Chinese presentation without rewriting original evidence", async () => {
    const presentation = { title: "电竞商业模式", summary: "说明赛事赞助和版权收入。" };
    const result = await screenResearchSources(runtime(), [direct], async (_system, input, validate) => {
      const output = evaluation(input as Input);
      const localized = { evaluations: output.evaluations.map((entry) => ({ ...entry, presentation })) };
      validate(localized); return localized;
    });
    expect(result[0]).toMatchObject({ title: direct.title, content: direct.content, url: direct.url, presentation });
    expect(direct).not.toHaveProperty("presentation");
  });
  it("screens mixed results using the full-stack HTTP provider double's scoped response", async () => {
    const result = await screenResearchSources(runtime(), [direct, { ...car, content: "Controlled unrelated vehicle inventory: Acura cars available for sale." }], async (system, context, validate) => {
      const value = JSON.parse(guidedResearchReply(`You are a research assistant. ${system}`, JSON.stringify(context))!);
      validate(value); return value;
    });
    expect(result.map((source) => source.id)).toEqual([direct.id]);
  });
  it("keeps grounded direct and competitor context, removes unrelated results before publication", async () => {
    const state = runtime(); const model = complete();
    const result = await screenResearchSources(state, [direct, context, car], model);
    expect(result.map((item) => item.id)).toEqual(["kpl", "competitor"]);
    expect(result.every((item) => /^[a-f0-9]{64}$/.test(item.relevanceBasis!))).toBe(true);
    expect(model.mock.calls[0]![1]).toMatchObject({ researchStage: "source_relevance", brief: session.brief, tasks: [{ query: "王者荣耀 KPL 商业模式" }] });
    expect(direct).not.toHaveProperty("relevanceBasis");
    expect(state.sources).toEqual([]);
  });

  it("reuses persisted approval only for the same subject, outline and source content", async () => {
    const state = runtime(); const model = complete();
    const approved = await screenResearchSources(state, [direct], model);
    await screenResearchSources(state, approved, model);
    expect(model).toHaveBeenCalledTimes(1);
    const changed = { ...approved[0]!, content: car.content };
    expect(await screenResearchSources(state, [changed], model)).toEqual([]);
    state.brief = { ...state.brief, topic: "新主题" };
    await screenResearchSources(state, approved, model);
    state.outline[0]!.questions = ["新的研究问题？"];
    await screenResearchSources(state, approved, model);
    expect(model).toHaveBeenCalledTimes(4);
  });

  it("preserves explicit user additions and exclusions without silently resurrecting them", async () => {
    const model = complete();
    const sources = [{ ...car, addedByUser: true }, { ...direct, decision: "excluded" as const }];
    expect(await screenResearchSources(runtime(), sources, model)).toEqual(sources);
    expect(model).not.toHaveBeenCalled();
  });

  it.each(["quote", "question", "duplicate", "missing", "contradiction"])("fails closed after one bounded repair of invalid %s evaluations", async (kind) => {
    const state = runtime();
    const model = vi.fn(async (_system: string, input: unknown, validate: (output: unknown) => void) => {
      const output = evaluation(input as Input);
      const entry = output.evaluations[0]!;
      if (kind === "quote") entry.matches[0]!.quote = "not in source";
      if (kind === "question") entry.matches[0]!.questionId = "invented";
      if (kind === "duplicate") output.evaluations[1] = entry;
      if (kind === "missing") output.evaluations.pop();
      if (kind === "contradiction") entry.irrelevant = true;
      validate(output); return output;
    });
    await expect(screenResearchSources(state, [direct, context], model)).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1]![1]).toHaveProperty("repair");
    expect(state.sources).toEqual([]);
  });

  it("does not retry provider/store failures even with the same public reason code", async () => {
    const model = vi.fn(async () => { throw new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"); });
    await expect(screenResearchSources(runtime(), [direct], model)).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("evaluates later chunks and publishes nothing if a later batch fails", async () => {
    const state = runtime(); const long = source("long", "x".repeat(24000) + direct.content);
    const model = vi.fn(async (_system: string, input: unknown, validate: (output: unknown) => void) => {
      const batch = input as Input;
      if (chunkText(batch.chunks[0]!) === direct.content) throw new Error("provider unavailable");
      const output = evaluation(batch); validate(output); return output;
    });
    await expect(screenResearchSources(state, [long], model)).rejects.toThrow("provider unavailable");
    expect(model).toHaveBeenCalledTimes(2);
    expect(state.sources).toEqual([]);
    expect(long.relevanceBasis).toBeUndefined();
  });
});

function serviceFixture(hits: typeof direct[], malformed = false, seed = runtime(), rejectTask?: string) {
  let state = seed;
  const writes: ResearchRuntime[] = [];
  const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => { state.version++; return { state: structuredClone(state), replay: false }; }, write: async (_actor, _request, next) => { state = structuredClone(next); writes.push(structuredClone(next)); } };
  const model = { complete: vi.fn(async (input: { user: string }) => {
    const context = JSON.parse(input.user);
    if (context.researchStage !== "source_relevance") throw new Error("report provider unavailable");
    const output = evaluation(context);
    for (const entry of output.evaluations) if (context.chunks.find((chunk: Input["chunks"][number]) => chunk.chunkId === entry.chunkId)?.taskId === rejectTask) { entry.irrelevant = true; entry.matches = []; }
    return { text: JSON.stringify(malformed ? {} : output) };
  }) };
  const search = vi.fn(async (_query: string) => hits.map(({ title, url, content }) => ({ title, url, content })));
  const dispatchModel = { complete: (input: { user: string }) => {
    const context = JSON.parse(input.user);
    return context.researchStage === "search_recovery" ? Promise.resolve({ text: JSON.stringify({ queries: [context.task.query] }) }) : model.complete(input);
  } };
  const service = new GuidedRuntimeService(store, dispatchModel, { search }, { provider: "test", id: "test" });
  const actor = { orgId: toOrgId("relevance-org"), userId: "owner", sessionId: session.sessionId };
  return { model, search, writes,
    report: () => service.execute(actor, session, { node: "report", action: "generate", sessionId: session.sessionId, requestId: "report", expectedVersion: state.version }),
    run: (action: "start" | "retry" = "start") => service.execute(actor, session, { node: "research", action, sessionId: session.sessionId, requestId: action, expectedVersion: state.version }) };
}
describe("research runtime source publication", () => {
  it("retries old succeeded tasks whose only source was rejected during migration", async () => {
    const seed = runtime(); seed.sources = [car]; seed.tasks[0]!.status = "succeeded";
    const f = serviceFixture([direct], false, seed); const result = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(result.errorCode).toBeNull();
    expect(result.sources.map((item) => item.url)).toEqual([direct.url]);
    expect(f.writes.some((state) => state.tasks[0]!.status === "failed" && state.tasks[0]!.errorCode === "RESEARCH_SEARCH_NO_RELEVANT_SOURCES")).toBe(true);
  });
  it("preserves partial-report consent when legacy source review removes irrelevant material", async () => {
    const seed = runtime(); seed.currentNode = "report"; seed.availableNodes.push("report"); seed.reportPartial = true;
    seed.tasks[0]!.status = "succeeded";
    seed.tasks.push({ ...seed.tasks[0]!, id: "failed", status: "failed", errorCode: "RESEARCH_SEARCH_UNAVAILABLE" });
    seed.sources = [direct, car];
    const f = serviceFixture([], false, seed); const result = await f.report();
    expect(result.errorCode).not.toBe("RESEARCH_TASKS_INCOMPLETE");
    expect(result.reportPartial).toBe(true);
    expect(result.currentNode).toBe("report");
    expect(result.availableNodes).toContain("report");
    expect(f.writes.some((state) => state.sources.length === 1 && state.currentNode === "report" && state.reportPartial)).toBe(true);
    expect(result.sources.map((item) => item.id)).toEqual([direct.id]);
    expect(f.model.complete.mock.calls.some(([input]) => JSON.parse(input.user).reportStage === "evidence")).toBe(true);
  });
  it("never persists raw unrelated search hits as accepted", async () => {
    const f = serviceFixture([direct, car]); const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(result.sources.map((item) => item.url)).toEqual([direct.url]);
    expect(f.writes.every((state) => state.sources.every((item) => item.url !== car.url))).toBe(true);
  });
  it.each([false, true])("empty relevance or invalid assessment keeps the task retryable (invalid=%s)", async (malformed) => {
    const f = serviceFixture(malformed ? [direct] : [car], malformed); const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(result.tasks[0]).toMatchObject({ status: "failed", errorCode: malformed ? "RESEARCH_SOURCE_RELEVANCE_INVALID" : "RESEARCH_SEARCH_NO_RELEVANT_SOURCES" });
    expect(result.sources).toEqual([]);
    expect(f.writes.every((state) => state.sources.length === 0)).toBe(true);
  });
});

function twoTasks() {
  const state = runtime();
  state.outline.push({ id: "retention", title: "留存", questions: ["王者荣耀玩家留存的证据是什么？"], enabled: true, order: 1 });
  state.tasks.push({ ...state.tasks[0]!, id: "b", sectionId: "retention", query: "王者荣耀 留存 数据", objective: "验证玩家留存" });
  return state;
}
describe("task-scoped relevance and cache", () => {
  it("rejects a model matching a different chapter even when that question exists", async () => {
    const state = twoTasks();
    const shared = { ...direct, taskIds: ["task", "b"] };
    const model = vi.fn(async (_system: string, input: unknown, validate: (value: unknown) => void) => {
      const context = input as Input; const output = evaluation(context);
      const other = context.chunks.find((chunk) => chunk.taskId === "b")!;
      output.evaluations.find((entry) => entry.chunkId === other.chunkId)!.matches[0]!.questionId = context.chunks.find((chunk) => chunk.taskId === "task")!.questionIds[0]!;
      validate(output); return output;
    });
    await expect(screenResearchSources(state, [shared], model)).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("cannot use a cached A result to complete B, and retries B without losing A", async () => {
    const f = serviceFixture([direct], false, twoTasks(), "b");
    const result = await f.run();
    expect(result.tasks.map((task) => task.status)).toEqual(["succeeded", "failed"]);
    expect(result.tasks[1]!.errorCode).toBe("RESEARCH_SEARCH_NO_RELEVANT_SOURCES");
    expect(result.sources[0]!.taskIds).toEqual(["task"]);
    expect(f.model.complete.mock.calls.map(([input]) => JSON.parse(input.user).chunks[0].taskId)).toEqual(["task", "b"]);
    const retried = await f.run("retry");
    expect(f.search.mock.calls.map(([query]) => query)).toEqual(["王者荣耀 KPL 商业模式", "王者荣耀 留存 数据"]);
    expect(retried.tasks.map((task) => task.status)).toEqual(["succeeded", "failed"]);
    expect(retried.sources[0]!.taskIds).toEqual(["task"]);
  });
  it("removes legacy B associations and primary taskId while retaining A and making B retryable", async () => {
    const seed = twoTasks(); seed.tasks.forEach((task) => { task.status = "succeeded"; });
    seed.sources = [{ ...direct, taskId: "b", taskIds: ["b", "task"] }];
    const f = serviceFixture([direct], false, seed, "b"); const result = await f.run();
    expect(result.sources[0]).toMatchObject({ taskId: "task", taskIds: ["task"] });
    expect(result.tasks.map((task) => task.status)).toEqual(["succeeded", "failed"]);
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.writes.some((state) => state.sources.length === 1 && state.sources[0]!.taskId === "task" && state.tasks[1]!.status === "failed")).toBe(true);
  });
  it("rechecks changed task objectives even when the source and outline are unchanged", async () => {
    const state = runtime(); const model = complete(); const approved = await screenResearchSources(state, [direct], model);
    state.tasks[0]!.objective = "核对赞助收入的精确数据";
    await screenResearchSources(state, approved, model);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("does not turn manual or excluded sources into automatic proof for another task", async () => {
    const seed = twoTasks(); seed.tasks[0]!.status = "succeeded";
    seed.sources = [{ ...direct, addedByUser: true }];
    const f = serviceFixture([direct], false, seed, "b"); const result = await f.run();
    expect(result.tasks[1]!.status).toBe("failed");
    expect(result.sources[0]).toMatchObject({ addedByUser: true, taskId: "task" });
    expect(result.sources[0]!.taskIds ?? []).not.toContain("b");
    const excluded = runtime(); excluded.sources = [{ ...direct, decision: "excluded" }];
    const removed = serviceFixture([direct], false, excluded); const next = await removed.run();
    expect(next.sources[0]!.decision).toBe("excluded");
    expect(next.tasks[0]!.status).toBe("failed");
    expect(removed.model.complete).not.toHaveBeenCalled();
  });
});


describe("actionable source output repair", () => {
  it.each(["json", "schema", "semantic"])("repairs %s output during a 43-source legacy review", async (kind) => {
    const seed = runtime(); seed.tasks[0]!.status = "succeeded";
    seed.sources = Array.from({ length: 43 }, (_, i) => source(`legacy-${i}`, direct.content));
    const f = serviceFixture([], false, seed);
    f.model.complete.mockImplementationOnce(async ({ user }) => {
      const value = evaluation(JSON.parse(user));
      if (kind === "json") return { text: '{"evaluations":[' };
      if (kind === "schema") return { text: JSON.stringify({ evaluations: value.evaluations.map(({ matches: _matches, ...entry }) => entry) }) };
      const entry = value.evaluations[0]!;
      entry.irrelevant = true;
      entry.matches[0]!.questionId = "wrong-chapter";
      entry.matches[0]!.quote = "fabricated quotation";
      return { text: JSON.stringify(value) };
    });
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(result.sources).toHaveLength(43);
    expect(result.sources.every((item) => item.relevanceBasis)).toBe(true);
    expect(f.search).not.toHaveBeenCalled();
    const repair = f.model.complete.mock.calls.map(([input]) => JSON.parse(input.user).repair).find(Boolean);
    expect(repair.previousOutput).toBeTruthy();
    if (kind === "json") expect(repair.issues).toContainEqual(expect.objectContaining({ code: "invalid_json" }));
    if (kind === "schema") expect(repair.issues).toContainEqual(expect.objectContaining({ path: ["evaluations", 0, "matches"] }));
    if (kind === "semantic") expect(repair.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(["task_question", "verbatim_quote", "contradiction"]));
    expect(f.model.complete).toHaveBeenCalledTimes(7); // six batches plus exactly one repair
  });

  it("repairs malformed evaluation of new search hits without repeating search", async () => {
    const f = serviceFixture([direct, car]);
    f.model.complete.mockImplementationOnce(async () => ({ text: '{"evaluations":[' }));
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(result.sources.map((source) => source.url)).toEqual([direct.url]);
    expect(result.tasks[0]!.status).toBe("succeeded");
  });

  it("stops after two malformed JSON outputs and preserves unreviewed legacy sources", async () => {
    const seed = runtime(); seed.sources = [direct]; seed.tasks[0]!.status = "succeeded";
    const f = serviceFixture([], false, seed);
    f.model.complete.mockImplementation(async () => ({ text: '{"evaluations":[' }));
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(f.search).not.toHaveBeenCalled();
    expect(result.sources).toEqual([direct]);
    expect(f.writes.every((item) => item.sources.every((source) => !source.relevanceBasis))).toBe(true);
  });

  it("bounds diagnostic feedback for oversized untrusted output keys", async () => {
    const seed = runtime(); seed.sources = [direct]; seed.tasks[0]!.status = "succeeded";
    const f = serviceFixture([], false, seed);
    f.model.complete.mockImplementationOnce(async () => ({ text: JSON.stringify({ ["x".repeat(50000)]: true }) }));
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    const repair = f.model.complete.mock.calls.map(([input]) => JSON.parse(input.user).repair).find(Boolean);
    expect(JSON.stringify(repair.issues).length).toBeLessThan(16000);
    expect(repair.issues.every((issue: { message: string }) => issue.message.length <= 320)).toBe(true);
    expect(repair.previousOutput.length).toBeLessThanOrEqual(24000);
  });

  it("does not publish a successful first batch when a later batch exhausts repair", async () => {
    const seed = runtime(); seed.tasks[0]!.status = "succeeded";
    seed.sources = Array.from({ length: 9 }, (_, i) => source(`legacy-${i}`, direct.content));
    const f = serviceFixture([], false, seed);
    f.model.complete.mockImplementation(async ({ user }) => {
      const context = JSON.parse(user);
      return { text: context.chunks.some((chunk: Input["chunks"][number]) => chunk.sourceId === "legacy-8") ? '{"evaluations":[' : JSON.stringify(evaluation(context)) };
    });
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
    expect(f.model.complete).toHaveBeenCalledTimes(3);
    expect(result.sources).toEqual(seed.sources);
    expect(f.writes.every((state) => state.sources.every((source) => !source.relevanceBasis))).toBe(true);
  });

  it("does not treat provider SyntaxError as malformed model output", async () => {
    const seed = runtime(); seed.sources = [direct]; seed.tasks[0]!.status = "succeeded";
    const f = serviceFixture([], false, seed);
    f.model.complete.mockImplementation(async () => { throw new SyntaxError("provider failure"); });
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(f.model.complete).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled();
  });
});

it("reevaluates retrieved facts against replacement chapter questions instead of deleting unexamined sources (#5081)", async () => {
  const state = runtime(); state.outline[0]!.id = "replacement";
  const model = complete(); const excluded = { ...context, decision: "excluded" as const };
  const result = await screenResearchSources(state, [direct, car, excluded], model);
  expect(model).toHaveBeenCalled();
  expect(result.map((item) => item.id)).toEqual([direct.id, excluded.id]);
  const input = model.mock.calls[0]![1] as Input;
  expect(input.chunks.every((chunk) => chunk.questionIds.length > 0)).toBe(true);
  expect(input.questions.every((question) => question.sectionId === "replacement")).toBe(true);
  expect(result[0]!.content).toBe(direct.content);
});


describe("bounded source screening batch work", () => {
  const batches = () => Array.from({ length: 4 }, (_, i) => source(`batch-${i}`, String(i).repeat(24000)));
  it("computes the same four batches with peak two and two waves of fixed work", async () => {
    vi.useFakeTimers();
    try {
      let active = 0, peak = 0, calls = 0;
      const model = async (_system: string, input: unknown, validate: (value: unknown) => void) => {
        calls++; active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        const value = evaluation(input as Input); validate(value); active--; return value;
      };
      const start = Date.now();
      const operation = screenResearchSources(runtime(), batches(), model);
      await vi.runAllTimersAsync();
      const concurrent = await operation;
      expect(concurrent).toHaveLength(4);
      expect(calls).toBe(4); expect(peak).toBe(2); expect(Date.now() - start).toBe(80);
      // Equal-work serial provider control: same four inputs, validator and outputs.
      active = 0; peak = 0; calls = 0;
      let lane = Promise.resolve(); const serialStart = Date.now();
      const serialOperation = screenResearchSources(runtime(), batches(), (system, input, validate) => {
        const next = lane.then(() => model(system, input, validate));
        lane = next.then(() => undefined); return next;
      });
      await vi.runAllTimersAsync();
      expect(await serialOperation).toEqual(concurrent);
      expect(calls).toBe(4); expect(peak).toBe(1); expect(Date.now() - serialStart).toBe(160);
    } finally { vi.useRealTimers(); }
  });
  it("merges reverse completions in original batch order including shared-source task identities and presentation", async () => {
    vi.useFakeTimers();
    try {
      const state = runtime(); state.tasks.push({ ...state.tasks[0]!, id: "task2" });
      const shared = { ...source("shared", "x".repeat(24000)), taskIds: ["task", "task2"] };
      const result = screenResearchSources(state, [shared], async (_system, input, validate) => {
        const batch = input as Input; const first = batch.chunks[0]!.taskId === "task";
        await new Promise(resolve => setTimeout(resolve, first ? 40 : 10));
        const value = { evaluations: evaluation(batch).evaluations.map(entry => ({ ...entry, presentation: { title: first ? "first" : "second", summary: "valid summary" } })) };
        validate(value); return value;
      });
      await vi.runAllTimersAsync();
      expect((await result)[0]).toMatchObject({ taskId: "task", taskIds: ["task", "task2"], presentation: { title: "first" } });
    } finally { vi.useRealTimers(); }
  });
  it("stops dispatch and partner repair on terminal failure, drains the active callback and preserves error identity", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("original transport failure");
      const sources = batches(); const before = structuredClone(sources); let calls = 0, active = 0;
      const operation = screenResearchSources(runtime(), sources, async (_system, input, validate) => {
        const index = calls++; active++;
        await new Promise(resolve => setTimeout(resolve, index === 0 ? 10 : 40));
        active--;
        if (index === 0) throw failure;
        validate({}); return {};
      });
      const settled = operation.then(() => ({ error: null }), error => ({ error }));
      await vi.advanceTimersByTimeAsync(10);
      expect(active).toBe(1);
      let returned = false; void settled.then(() => { returned = true; }); await Promise.resolve(); expect(returned).toBe(false);
      await vi.runAllTimersAsync();
      expect((await settled).error).toBe(failure); expect(calls).toBe(2); expect(active).toBe(0); expect(sources).toEqual(before);
    } finally { vi.useRealTimers(); }
  });
  it("serializes service attempt admission writes while two source models are in flight", async () => {
    vi.useFakeTimers();
    try {
      const state = runtime(); state.sources = batches(); state.tasks[0]!.status = "succeeded";
      let writing = 0, peakWrites = 0, active = 0, peakModels = 0; const snapshots: ResearchRuntime[] = [];
      const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => ({ state: structuredClone(state), replay: false }), write: async (_actor, _id, value) => {
        writing++; peakWrites = Math.max(peakWrites, writing); await new Promise(resolve => setTimeout(resolve, 5)); snapshots.push(structuredClone(value)); writing--;
      } };
      const model = { complete: async (input: { user: string }) => {
        const context = JSON.parse(input.user); if (context.researchStage !== "source_relevance") throw new Error("stop after screening");
        active++; peakModels = Math.max(peakModels, active); await new Promise(resolve => setTimeout(resolve, 40)); active--;
        return { text: JSON.stringify(evaluation(context)) };
      } };
      const service = new GuidedRuntimeService(store, model, { search: async () => [] }, { provider: "test", id: "test" });
      const operation = service.execute({ sessionId: session.sessionId, orgId: toOrgId("org"), userId: "user" }, session,
        { sessionId: session.sessionId, requestId: "concurrent", node: "research", action: "complete", expectedVersion: 0 });
      await vi.runAllTimersAsync(); await operation;
      expect(peakWrites).toBe(1); expect(peakModels).toBe(2); expect(active).toBe(0);
      expect(snapshots.some(snapshot => snapshot.modelCalls.length >= 2)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("does not repair a slow malformed first batch after its partner fatally fails", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("partner fatal"); let calls = 0;
      const operation = screenResearchSources(runtime(), batches(), async (_system, _input, validate) => {
        const index = calls++; await new Promise(resolve => setTimeout(resolve, index === 0 ? 40 : 10));
        if (index === 1) throw failure;
        validate({}); return {};
      });
      const outcome = operation.catch(error => error); await vi.runAllTimersAsync();
      expect(await outcome).toBe(failure); expect(calls).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it("does not start either provider when serialized pre-call persistence fails", async () => {
    const state = runtime(); state.sources = batches(); state.tasks[0]!.status = "succeeded";
    const failure = new Error("attempt persistence failed"); let writes = 0;
    const model = { complete: vi.fn(async () => ({ text: "{}" })) };
    const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => ({ state: structuredClone(state), replay: false }),
      write: async () => { if (++writes === 1) throw failure; } };
    const service = new GuidedRuntimeService(store, model, { search: async () => [] }, { provider: "test", id: "test" });
    const result = await service.execute({ sessionId: session.sessionId, orgId: toOrgId("org"), userId: "user" }, session,
      { sessionId: session.sessionId, requestId: "write-failure", node: "research", action: "complete", expectedVersion: 0 });
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE"); expect(model.complete).not.toHaveBeenCalled();
    expect(result.sources).toEqual(state.sources); expect(result.modelCalls).toHaveLength(1);
  });
  it("shares the existing report budget, stops queued calls, and ignores late pure provider results", async () => {
    vi.useFakeTimers();
    try {
      const state = runtime(); state.currentNode = "report"; state.availableNodes.push("report"); state.sources = batches(); state.tasks[0]!.status = "succeeded";
      const late: (() => void)[] = []; const signals: AbortSignal[] = [];
      const model = { complete: vi.fn(async (input: { user: string; signal?: AbortSignal }) => {
        signals.push(input.signal!); const context = JSON.parse(input.user);
        return new Promise<{ text: string }>(resolve => late.push(() => resolve({ text: JSON.stringify(evaluation(context)) })));
      }) };
      const snapshots: ResearchRuntime[] = [];
      const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => ({ state: structuredClone(state), replay: false }), write: async (_actor, _id, value) => { snapshots.push(structuredClone(value)); } };
      const service = new GuidedRuntimeService(store, model, { search: async () => [] }, { provider: "test", id: "test" });
      const operation = service.execute({ sessionId: session.sessionId, orgId: toOrgId("org"), userId: "user" }, session,
        { sessionId: session.sessionId, requestId: "budget", node: "report", action: "generate", expectedVersion: 0 });
      await vi.advanceTimersByTimeAsync(180000); const result = await operation;
      expect(result.errorCode).toBe("RESEARCH_REPORT_PREPARATION_TIME_BUDGET_EXCEEDED"); expect(result.busy).toBe(false);
      expect(model.complete).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
      const writes = snapshots.length, before = structuredClone(result); late.forEach(resolve => resolve()); await vi.runAllTimersAsync();
      expect(snapshots).toHaveLength(writes); expect(result).toEqual(before); expect(result.sources).toEqual(state.sources);
    } finally { vi.useRealTimers(); }
  });
  it("does not dispatch a provider after the budget expires while admission persistence is pending", async () => {
    vi.useFakeTimers();
    try {
      const state = runtime(); state.currentNode = "report"; state.availableNodes.push("report"); state.sources = batches(); state.tasks[0]!.status = "succeeded";
      let writes = 0;
      const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => ({ state: structuredClone(state), replay: false }), write: async () => { if (++writes === 2) await new Promise(resolve => setTimeout(resolve, 200000)); } };
      const model = { complete: vi.fn(async () => ({ text: "{}" })) };
      const service = new GuidedRuntimeService(store, model, { search: async () => [] }, { provider: "test", id: "test" });
      const operation = service.execute({ sessionId: session.sessionId, orgId: toOrgId("org"), userId: "user" }, session,
        { sessionId: session.sessionId, requestId: "admission-budget", node: "report", action: "generate", expectedVersion: 0 });
      await vi.runAllTimersAsync(); const result = await operation;
      expect(result.errorCode).toBe("RESEARCH_REPORT_PREPARATION_TIME_BUDGET_EXCEEDED"); expect(model.complete).not.toHaveBeenCalled();
      expect(result.modelCalls).toHaveLength(1); const savedWrites = writes; await vi.runAllTimersAsync(); expect(writes).toBe(savedWrites);
    } finally { vi.useRealTimers(); }
  });

  it("does not parse or mark a late valid provider success after its partner terminally fails", async () => {
    vi.useFakeTimers();
    const parser = vi.spyOn(relevanceModule, "parseSourceRelevanceJson");
    try {
      const state = runtime(); state.sources = batches(); state.tasks[0]!.status = "succeeded";
      let calls = 0;
      const model = { complete: async (input: { user: string }) => {
        const index = calls++; await new Promise(resolve => setTimeout(resolve, index === 0 ? 10 : 40));
        if (index === 0) throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
        return { text: JSON.stringify(evaluation(JSON.parse(input.user))) };
      } };
      const snapshots: ResearchRuntime[] = [];
      const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => ({ state: structuredClone(state), replay: false }),
        write: async (_actor, _id, value) => { snapshots.push(structuredClone(value)); } };
      const service = new GuidedRuntimeService(store, model, { search: async () => [] }, { provider: "test", id: "test" });
      const operation = service.execute({ sessionId: session.sessionId, orgId: toOrgId("org"), userId: "user" }, session,
        { sessionId: session.sessionId, requestId: "late-valid", node: "research", action: "complete", expectedVersion: 0 });
      await vi.runAllTimersAsync(); const result = await operation;
      expect(result.errorCode).toBe("RESEARCH_SEARCH_UNAVAILABLE"); expect(calls).toBe(2);
      expect(parser).not.toHaveBeenCalled();
      expect(result.modelCalls.map(call => call.status)).toEqual(["failed", "failed"]);
      expect(result.sources).toEqual(state.sources); const writes = snapshots.length; await vi.runAllTimersAsync(); expect(snapshots).toHaveLength(writes);
    } finally { parser.mockRestore(); vi.useRealTimers(); }
  });

});

it("rejects evidence that answers only a sibling of the task's confirmed question", async () => {
  const state = runtime(); state.outline[0]!.questions = ["赛事收入来自哪里？", "玩家留存如何？"];
  const questions = reportQuestions(state.outline);
  state.tasks = tasksFromConfirmedQuestions(state);
  const candidate = { ...direct, taskId: state.tasks[0]!.id };
  const model = vi.fn(async (_system: string, input: unknown, validate: (value: unknown) => void) => {
    const context = input as Input;
    const output = evaluation(context);
    output.evaluations[0]!.matches[0]!.questionId = questions[1]!.id;
    validate(output); return output;
  });
  await expect(screenResearchSources(state, [candidate], model)).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
  expect(state.tasks.map(task => task.questionId)).toEqual(questions.map(question => question.id));
  expect(model).toHaveBeenCalledTimes(2);
});

it("preserves question identity when task scheduling order differs from outline array order", async () => {
  const state = runtime(); state.outline[0]!.order = 1;
  state.outline.push({ id: "first", title: "优先章节", questions: ["优先问题？"], enabled: true, order: 0 });
  const questions = reportQuestions(state.outline);
  state.tasks = tasksFromConfirmedQuestions(state);
  expect(state.tasks.map(task => task.sectionId)).toEqual(["first", "esports"]);
  for (const task of state.tasks) expect(task.questionId).toBe(questions.find(question => question.sectionId === task.sectionId)!.id);
  const sources = state.tasks.map((task, index) => ({ ...direct, id: `source-${index}`, taskId: task.id }));
  const result = await screenResearchSources(state, sources, complete());
  expect(result.map(source => source.id)).toEqual(sources.map(source => source.id));
});
