import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
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
type Input = { chunks: { sourceId: string; chunkId: string; taskId: string; questionIds: string[]; content: string }[]; questions: { id: string }[] };
function evaluation(input: Input) {
  return { evaluations: input.chunks.map((chunk) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId,
    irrelevant: chunk.content === car.content, matches: chunk.content === car.content ? [] : [{ questionId: chunk.questionIds[0]!,
      quote: chunk.content.slice(0, 300), insight: "控制模型夹具：摘录支持对应的电竞商业模式比较。", relevance: chunk.content === context.content ? "context" : "direct" }] })) };
}
function complete() {
  return vi.fn(async (_system: string, input: unknown, validate: (output: unknown) => void) => { const output = evaluation(input as Input); validate(output); return output; });
}

describe("automatic research source relevance", () => {
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
      if (batch.chunks[0]!.content === direct.content) throw new Error("provider unavailable");
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
  const service = new GuidedRuntimeService(store, model, { search }, { provider: "test", id: "test" });
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
    await f.run("retry");
    expect(f.search.mock.calls.map(([query]) => query)).toEqual(["王者荣耀 KPL 商业模式", "王者荣耀 留存 数据", "王者荣耀 留存 数据"]);
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
