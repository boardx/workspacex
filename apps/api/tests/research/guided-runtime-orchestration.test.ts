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
  const store: GuidedRuntimeStore = { read: async () => state, claim: async () => { state.errorCode = null; state.busy = true; return { state, replay: false }; }, write: async (_a, _r, value) => { state = structuredClone(value); writes.push(structuredClone(value)); } };
  const actor = { orgId: toOrgId("org"), userId: "owner", sessionId: session.sessionId };
  return { session, actor, store, writes, state, latest: () => state };
}

describe("durable research orchestration", () => {
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
    const model = { complete: vi.fn() };
    const service = new GuidedRuntimeService(f.store, model, { search }, { provider: "test", id: "test" });
    const execute = (action: "start" | "retry") => service.execute(f.actor, f.session, { sessionId: "session", node: "research", action, requestId: action, expectedVersion: f.latest().version });
    const first = await execute("start");
    expect(maxActive).toBe(3);
    expect(first.tasks.filter((t) => t.status === "succeeded")).toHaveLength(6);
    expect(first.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(first.sources.find((s) => s.id === "excluded")).toMatchObject({ decision: "excluded", taskIds: expect.arrayContaining(["older", "t0", "t6"]) });
    expect(f.writes.some((s) => s.progress?.stage === "searching" && s.tasks.filter((t) => t.status === "running").length === 3)).toBe(true);
    fail = false;
    const second = await execute("retry");
    expect(search).toHaveBeenCalledTimes(8);
    expect(model.complete).not.toHaveBeenCalled();
    expect(second.tasks.map((t) => t.attempts)).toEqual([1, 1, 2, 1, 1, 1, 1]);
    expect(second.sources.find((s) => s.id === "excluded")?.taskIds).toContain("t2");
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
