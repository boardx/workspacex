import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { toOrgId } from "../../src/domain/org-id";
import type { GuidedRuntimeStore, ResearchRuntime } from "../../src/application/research/guided-runtime-ports";

function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "session", title: "Research", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  let state = initialRuntime(session);
  state.currentNode = "research"; state.availableNodes = ["brief", "directions", "outline", "research"];
  state.outline = [{ id: "o", title: "Policy", questions: ["Which policy?"], enabled: true, order: 0 }];
  const writes: ResearchRuntime[] = [];
  const store: GuidedRuntimeStore = { read: async () => state, claim: async () => { state.errorCode = null; state.busy = true; return { state, replay: false }; }, write: async (_a, _r, value) => { state = C.GuidedResearchRuntime.parse(structuredClone(value)); writes.push(structuredClone(value)); } };
  const actor = { orgId: toOrgId("org"), userId: "owner", sessionId: session.sessionId };
  return { session, actor, store, writes, state, latest: () => state };
}

describe("durable research orchestration", () => {
  it("supplements chapter evidence with scoped queries until three readable sources exist", async () => {
    const f = fixture();
    f.state.tasks = [{ id: "t", sectionId: "o", query: "Grid EU policy", status: "pending", attempts: 0, errorCode: null }];
    const search = vi.fn(async (query: string) => [{ title: "Grid policy", url: `https://example.org/${query.includes("Which policy?") ? "third" : query.includes("primary source") ? "second" : "first"}`, content: "Grid EU policy requires permits." }]);
    const read = vi.fn(async () => ({ text: "Grid EU policy requires permits.", contentKind: "text" as const, truncated: false }));
    const model = { complete: vi.fn(async (input: { user: string }) => {
      const context = JSON.parse(input.user);
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; quoteOptions: {text: string; quoteRef: string}[] }) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
        matches: [{ questionId: context.questions[0].id, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Policy evidence", relevance: "direct" }] })) }) };
    }) };
    const service = new GuidedRuntimeService(f.store, model, { search, read }, { provider: "test", id: "test" });
    const result = await service.execute(f.actor, f.session, { sessionId: "session", node: "research", action: "start", requestId: "scoped-coverage", expectedVersion: 0 });
    expect(result.errorCode).toBeNull();
    expect(result.sources.filter((source) => source.decision === "accepted" && source.document)).toHaveLength(3);
    expect(search.mock.calls.slice(1).every(([query]) => query.includes("Grid") && query.includes("EU"))).toBe(true);
    expect(search.mock.calls.some(([query]) => query.includes("Which policy?"))).toBe(true);
  });

  it.each(["task", "question"])("keeps long %s supplemental queries valid through strict persistence", async (field) => {
    const f = fixture();
    f.state.brief.topic = "题".repeat(200); f.state.brief.region = "区".repeat(200);
    f.state.tasks = [{ id: "t", sectionId: "o", query: field === "task" ? "查".repeat(1000) : "Grid policy", status: "pending", attempts: 0, errorCode: null }];
    if (field === "question") f.state.outline[0]!.questions = ["问".repeat(1000)];
    const search = vi.fn(async (_query: string) => [{ title: "Policy", url: "https://example.org/policy", content: "Grid policy requires permits." }]);
    const model = { complete: vi.fn(async (input: { user: string }) => {
      const context = JSON.parse(input.user);
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; content: string }) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: [{ questionId: context.questions[0].id, quote: chunk.content, insight: "Policy evidence", relevance: "direct" }] })) }) };
    }) };
    const service = new GuidedRuntimeService(f.store, model, { search, read: async () => ({ text: "Grid policy requires permits.", contentKind: "text", truncated: false }) }, { provider: "test", id: "test" });
    const result = await service.execute(f.actor, f.session, { sessionId: "session", node: "research", action: "retry", requestId: "long-query", expectedVersion: 0 });
    expect(result.busy).toBe(false);
    expect(result.errorCode).toBeNull();
    expect(search.mock.calls.length).toBeGreaterThan(1);
    expect(search.mock.calls.every((args) => (args[0] as string).length <= 1000)).toBe(true);
    expect(result.tasks[0]!.query).toBe(f.state.tasks[0]!.query);
    expect(() => C.GuidedResearchRuntime.parse(result)).not.toThrow();
  });

  it("loads authorized internal artifacts into the evidence pipeline", async () => {
    const f = fixture();
    f.state.sourcePolicy = { mode: "open", domains: [], internalSourceIds: ["artifact-1"], revision: 1 };
    f.state.tasks = [{ id: "task-1", sectionId: "o", query: "internal policy", status: "pending", attempts: 0, errorCode: null }];
    const search = vi.fn(async () => []);
    const model = { complete: vi.fn(async (input: { user: string }) => {
      const context = JSON.parse(input.user);
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; quoteOptions: {text: string; quoteRef: string}[] }) => ({
        sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
        matches: [{ questionId: context.questions[0].id, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Internal policy evidence", relevance: "direct" }],
      })) }) };
    }) };
    const access = {
      authorizedSourceIds: vi.fn(async () => ["artifact-1"]),
      loadAuthorizedSources: vi.fn(async () => [{ id: "artifact-1", title: "Internal policy", content: "Approved internal evidence", retrievedAt: "2026-09-24T00:00:00Z", contentHash: "a".repeat(64) }]),
    };
    const service = new GuidedRuntimeService(f.store, model, { search }, { provider: "test", id: "test" }, model, access);
    const result = await service.execute(f.actor, f.session, { sessionId: "session", node: "research", action: "start", requestId: "start-internal", expectedVersion: 0 });
    expect(search).not.toHaveBeenCalled();
    expect(result.tasks[0]).toMatchObject({ status: "succeeded", errorCode: null });
    expect(result.sources[0]).toMatchObject({ id: "internal:artifact-1", decision: "accepted", document: { text: "Approved internal evidence" } });
  });

  it("bounds searches, preserves completed results and excluded sources, and retries only failures", async () => {
    const f = fixture();
    f.state.tasks = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, sectionId: "o", query: `q${i}`, status: "pending" as const, attempts: 0, errorCode: null }));
    f.state.sources = [{ id: "excluded", taskId: "older", title: "Excluded", url: "https://example.org/shared", content: "User excluded this source", retrievedAt: "now", decision: "excluded" }];
    let active = 0; let maxActive = 0; let fail = true;
    const search = vi.fn(async (query: string) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2)); active--;
      if (query === "q2" && fail) throw new Error("Provider unavailable");
      return [{ title: query, url: "https://example.org/shared", content: "Evidence" }, { title: query, url: `https://example.org/${query}`, content: "Evidence" }];
    });
    const model = { complete: vi.fn(async (input: { user: string }) => {
      const context = JSON.parse(input.user);
      expect(context.researchStage).toBe("source_relevance");
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; quoteOptions: {text: string; quoteRef: string}[] }) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
        matches: [{ questionId: context.questions[0].id, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Controlled policy evidence", relevance: "direct" }] })) }) };
    }) };
    const service = new GuidedRuntimeService(f.store, model, { search }, { provider: "test", id: "test" });
    const execute = (action: "start" | "retry") => service.execute(f.actor, f.session, { sessionId: "session", node: "research", action, requestId: action, expectedVersion: f.latest().version });
    const first = await execute("start");
    expect(maxActive).toBe(3);
    expect(first.tasks.filter((t) => t.status === "succeeded")).toHaveLength(6);
    expect(first.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(first.sources.find((s) => s.id === "excluded")).toMatchObject({ decision: "excluded", taskId: "older" });
    expect(first.sources.find((s) => s.id === "excluded")?.taskIds).toBeUndefined();
    expect(f.writes.some((s) => s.progress?.stage === "searching" && s.tasks.filter((t) => t.status === "running").length === 3)).toBe(true);
    fail = false;
    const second = await execute("retry");
    expect(search).toHaveBeenCalledTimes(8);
    expect(model.complete).toHaveBeenCalledTimes(7);
    expect(second.tasks.map((t) => t.attempts)).toEqual([1, 1, 2, 1, 1, 1, 1]);
    expect(second.sources.find((s) => s.id === "excluded")?.taskIds).toBeUndefined();
    expect(second.progress).toBeNull();
  });

  it("persists a structured plan and rejects a plan that omits the confirmed outline", async () => {
    const f = fixture();
    const plan = { overview: "Compare official policy", optimizedQuestion: "Which grid policy supports entry?", tasks: [{ sectionId: "o", title: "Policy verification", objective: "Compare official constraints", deliverables: ["Dated policy evidence"], query: "official grid policy" }] };
    const model = { complete: vi.fn(async () => ({ text: JSON.stringify(plan) })) };
    const service = new GuidedRuntimeService(f.store, model, { search: vi.fn() }, { provider: "test", id: "test" });
    const generate = () => service.execute(f.actor, f.session, { sessionId: "session", node: "research", action: "generate", requestId: "plan", expectedVersion: f.latest().version });
    const result = await generate();
    expect(result.researchPlan).toEqual({ overview: plan.overview, optimizedQuestion: plan.optimizedQuestion });
    expect(result.tasks[0]).toMatchObject(plan.tasks[0]!);
    expect(f.writes.some((s) => s.progress?.stage === "planning")).toBe(true);
    plan.tasks[0]!.sectionId = "unknown";
    const rejected = await generate();
    expect(rejected.errorCode).toBe("RESEARCH_NODE_STATE_INVALID");
    expect(rejected.tasks[0]?.sectionId).toBe("o");
    expect(rejected.modelCalls.at(-1)?.status).toBe("failed");
  });
});
