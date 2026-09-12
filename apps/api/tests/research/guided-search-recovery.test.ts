import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type ResearchRuntime, type GuidedRuntimeStore } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";

const original = '"Honor of Kings" international Southeast Asia market share "Mobile Legends: Bang Bang" comparison 2023-2027 localization strategy';
const short = 'Honor of Kings Southeast Asia official launch';
const second = 'Honor of Kings Mobile Legends market share';
const hit = { title: "Honor of Kings official", url: "https://example.org/hok", content: "Honor of Kings launched in Southeast Asia with localized events." };
const car = { title: "Cars", url: "https://example.org/cars", content: "Controlled unrelated vehicle inventory" };
const session = C.GuidedResearchSession.parse({ sessionId: "recovery", title: "王者荣耀", brief: { topic: "王者荣耀", goal: "国际版市场", region: "东南亚", timeRange: "2023-2027", focus: "本地化" }, stage: "researching", resumeStage: "researching", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
function seed() {
  const state = initialRuntime(session);
  state.currentNode = "research"; state.availableNodes = ["brief", "directions", "outline", "research"]; state.generatedNodes = ["brief", "directions", "outline", "research"];
  state.outline = [{ id: "market", title: "市场进入", questions: ["国际版如何本地化？"], enabled: true, order: 0 }];
  state.tasks = [{ id: "task", sectionId: "market", title: "东南亚本地化", objective: "查明王者荣耀在东南亚的本地化", query: original, status: "pending", attempts: 0, errorCode: null }];
  return state;
}
function fixture(initial = seed()) {
  let state = structuredClone(initial);
  const writes: ResearchRuntime[] = [];
  const write = vi.fn(async (_actor: unknown, _request: string, next: ResearchRuntime) => { state = structuredClone(next); writes.push(state); });
  const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => { state.version++; state.errorCode = null; state.busy = true; return { state: structuredClone(state), replay: false }; }, write };
  let queries = [short, second];
  const model = { complete: vi.fn(async (input: { system: string; user: string }) => {
    const context = JSON.parse(input.user);
    if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries }) };
    return { text: guidedResearchReply(input.system, input.user)! };
  }) };
  const search = vi.fn(async (query: string) => query === original ? [] : [hit]);
  const actor = { orgId: toOrgId("recovery-org"), userId: "owner", sessionId: session.sessionId };
  const service = new GuidedRuntimeService(store, model, { search }, { provider: "test", id: "test" });
  return { model, search, writes, write, setQueries: (next: string[]) => { queries = next; },
    run: (action: "start" | "retry" | "complete" = "start", allowPartialResearch = false) => service.execute(actor, session, { node: "research", action, sessionId: session.sessionId, requestId: String(state.version), expectedVersion: state.version, ...(allowPartialResearch ? { allowPartialResearch: true } : {}) }) };
}

describe("bounded search query recovery", () => {
  it.each([false, true])("recovers empty or irrelevant results with a distinct query (irrelevant=%s)", async (irrelevant) => {
    const f = fixture(); f.search.mockImplementation(async (query) => query === original ? irrelevant ? [car] : [] : [hit]);
    const state = await f.run();
    expect(state.errorCode).toBeNull();
    expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, short]);
    expect(state.tasks[0]!.query).toBe(original);
    expect(state.tasks[0]!.searchAttempts?.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
    expect(state.sources.map((source) => source.url)).toEqual([hit.url]);
    expect(f.writes.some((state) => state.tasks[0]!.searchAttempts?.at(-1)?.status === "running")).toBe(true);
    const report = await f.run("complete");
    expect(report.currentNode).toBe("report");
    expect(report.errorCode).toBeNull();
    expect(report.report).not.toBeNull();
    expect(report.reportPartial).toBe(false);
  });
  it("bounds empty recovery to two alternatives and retains a real failure", async () => {
    const f = fixture(); f.search.mockResolvedValue([]);
    const state = await f.run();
    expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, short, second]);
    expect(state.tasks[0]!.errorCode).toBe("RESEARCH_SEARCH_EMPTY");
    expect(state.sources).toEqual([]);
  });
  it("does not repeat previously exhausted queries after retry or refresh", async () => {
    const f = fixture(); f.search.mockResolvedValue([]); const failed = await f.run();
    const resumed = fixture(failed); resumed.setQueries([short, "Honor of Kings localized events"]);
    const state = await resumed.run("retry");
    expect(resumed.search.mock.calls.map(([query]) => query)).toEqual(["Honor of Kings localized events"]);
    expect(state.tasks[0]!.status).toBe("succeeded");
  });
  it("ignores duplicate query rewrites including quotation and whitespace changes", async () => {
    const f = fixture(); f.setQueries([original.replaceAll('"', ''), `  ${original}  `]);
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(state.tasks[0]!.status).toBe("failed");
  });
  it.each([new Error("provider"), new ResearchRuntimeError("RESEARCH_SEARCH_EMPTY")])("does not rewrite after a provider exception", async (error) => {
    const f = fixture(); f.search.mockRejectedValue(error);
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.model.complete).not.toHaveBeenCalled();
    const resumed = fixture(state); resumed.search.mockRejectedValue(error);
    const retried = await resumed.run("retry");
    expect(resumed.search).toHaveBeenCalledTimes(1);
    expect(resumed.model.complete).not.toHaveBeenCalled();
    expect(retried.tasks[0]!.errorCode).toBe("RESEARCH_SEARCH_UNAVAILABLE");
  });
  it("does not rewrite after relevance validation fails", async () => {
    const f = fixture(); f.search.mockResolvedValue([hit]); f.model.complete.mockResolvedValue({ text: "{}" });
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(state.tasks[0]!.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
  });
  it("does not search when recording the attempt fails", async () => {
    const f = fixture(); f.write.mockImplementation(async (_actor, _request, state) => {
      if (state.tasks[0]!.searchAttempts?.length) throw new ResearchRuntimeError("RESEARCH_SEARCH_EMPTY");
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.search).not.toHaveBeenCalled();
  });
  it("does not replay successful tasks and keeps recovery within its durable budget", async () => {
    const state = seed(); state.tasks[0]!.status = "failed"; state.tasks[0]!.errorCode = "RESEARCH_SEARCH_EMPTY";
    state.tasks[0]!.searchAttempts = Array.from({ length: C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT }, (_, index) => ({ query: `query ${index}`, status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY" }));
    const f = fixture(state); const result = await f.run("retry");
    expect(f.search).not.toHaveBeenCalled(); expect(f.model.complete).not.toHaveBeenCalled();
    expect(result.tasks[0]!.status).toBe("failed");
  });
  it("allows an explicitly partial report after exhausted recovery while preserving gaps", async () => {
    const f = fixture(); await f.run();
    const state = f.writes.at(-1)!;
    state.tasks.push({ ...state.tasks[0]!, id: "missing", status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY", searchAttempts: undefined });
    const partial = fixture(state);
    const blocked = await partial.run("complete");
    expect(blocked.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE");
    const report = await partial.run("complete", true);
    expect(report.currentNode).toBe("report"); expect(report.errorCode).toBeNull();
    expect(report.reportPartial).toBe(true); expect(report.report).not.toBeNull();
    expect(report.tasks.find((task) => task.id === "missing")!.status).toBe("failed");
    expect(partial.search).not.toHaveBeenCalled();
  });
  it("does not permit partial continuation without any real source", async () => {
    const state = seed(); state.tasks[0]!.status = "failed";
    const f = fixture(state); const result = await f.run("complete", true);
    expect(result.report).toBeNull(); expect(result.currentNode).toBe("research");
    expect(result.errorCode).toBe("RESEARCH_SOURCES_REQUIRED");
  });
});
