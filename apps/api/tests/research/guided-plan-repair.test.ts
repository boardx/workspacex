import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type GuidedRuntimeStore, type ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";

const validPlan = {
  overview: "Compare entry requirements", optimizedQuestion: "Which policy and market constraints affect entry?",
  tasks: ["policy", "market"].map((sectionId) => ({ sectionId, title: `${sectionId} verification`, objective: `Verify ${sectionId} constraints`, deliverables: ["Dated primary evidence"], query: `official ${sectionId} grid storage` })),
};

function fixture(responses: unknown[]) {
  const session = C.GuidedResearchSession.parse({ sessionId: "session", title: "Research", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  let state = initialRuntime(session);
  state.currentNode = "research"; state.availableNodes = ["brief", "directions", "outline", "research"];
  state.outline = ["policy", "market", "disabled"].map((id, order) => ({ id, title: id, questions: [`Which ${id} constraints?`], enabled: id !== "disabled", order }));
  const writes: ResearchRuntime[] = [];
  const write = vi.fn(async (_actor: unknown, _request: string, value: ResearchRuntime, _done: boolean) => { state = structuredClone(value); writes.push(structuredClone(value)); });
  const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => { state.version++; state.errorCode = null; state.busy = true; return { state: structuredClone(state), replay: false }; }, write };
  let responseIndex = 0;
  const complete = vi.fn(async (_input: ModelCallInput) => {
    const response = responses[Math.min(responseIndex++, responses.length - 1)];
    if (response instanceof Error) throw response;
    return { text: JSON.stringify(response) };
  });
  const search = vi.fn(async () => [{ title: "Official evidence", url: "https://example.org/policy", content: "Documented grid entry requirements" }]);
  const service = new GuidedRuntimeService(store, { complete }, { search }, { provider: "test", id: "test" });
  const actor = { orgId: toOrgId("org"), userId: "owner", sessionId: session.sessionId };
  const run = (action: "generate" | "start" = "generate") => service.execute(actor, session, { sessionId: session.sessionId, node: "research", action, requestId: action, expectedVersion: state.version });
  return { complete, search, write, writes, run };
}

function expectRepairContext(f: ReturnType<typeof fixture>) {
  const first = JSON.parse(f.complete.mock.calls[0]![0].user);
  const next = JSON.parse(f.complete.mock.calls[1]![0].user);
  expect(first.allowedSectionIds).toEqual(["policy", "market"]);
  expect(first).not.toHaveProperty("repair");
  expect(next.repair).toMatchObject({ previousOutput: expect.any(String), allowedSectionIds: ["policy", "market"] });
  expect(next.repair.previousOutput.length).toBeGreaterThan(0);
  expect(next.repair.issues).toBeDefined();
  expect(JSON.stringify(next.repair.issues)).not.toBe("[]");
}

describe("bounded research plan repair", () => {
  it("repairs a missing required field and publishes only the complete validated plan", async () => {
    const invalid = { tasks: validPlan.tasks, overview: validPlan.overview };
    const f = fixture([invalid, validPlan]);
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(f.complete).toHaveBeenCalledTimes(2);
    expectRepairContext(f);
    expect(result.tasks).toEqual(validPlan.tasks.map((task) => expect.objectContaining({ ...task, status: "pending" })));
    expect(result.researchPlan).toEqual({ overview: validPlan.overview, optimizedQuestion: validPlan.optimizedQuestion });
    expect(result.modelCalls.map((call) => call.status)).toEqual(["failed", "succeeded"]);
    expect(f.search).not.toHaveBeenCalled();
    const beforeSuccess = f.writes.filter((snapshot) => !snapshot.modelCalls.some((call) => call.status === "succeeded"));
    expect(beforeSuccess.length).toBeGreaterThan(0);
    expect(beforeSuccess.every((snapshot) => snapshot.tasks.length === 0 && snapshot.sources.length === 0 && !snapshot.researchPlan)).toBe(true);
  });

  it.each(["unknown", "missing"] as const)("repairs %s section coverage without relaxing the confirmed outline", async (kind) => {
    const invalid = { ...validPlan, tasks: kind === "missing" ? validPlan.tasks.slice(0, 1) : validPlan.tasks.map((task, index) => index ? { ...task, sectionId: "invented" } : task) };
    const f = fixture([invalid, validPlan]);
    const result = await f.run("start");
    expect(result.errorCode).toBeNull();
    expect(f.complete).toHaveBeenCalledTimes(2);
    expectRepairContext(f);
    expect(result.tasks.map((task) => task.sectionId)).toEqual(["policy", "market"]);
    expect(result.tasks.every((task) => task.status === "succeeded")).toBe(true);
    expect(f.search).toHaveBeenCalledTimes(2);
  });

  it("reports schema and section coverage problems together in the single repair opportunity", async () => {
    const invalid = {
      overview: validPlan.overview,
      tasks: validPlan.tasks.map((task, index) => index === 1 ? { ...task, sectionId: "invented" } : task),
    };
    const f = fixture([invalid, validPlan]);
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(f.complete).toHaveBeenCalledTimes(2);
    const issues = JSON.parse(f.complete.mock.calls[1]![0].user).repair.issues as Array<{ path: Array<string | number>; message: string }>;
    expect(issues.some((issue) => issue.path.join(".") === "optimizedQuestion")).toBe(true);
    expect(issues.some((issue) => issue.path.join(".") === "tasks.1.sectionId")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("market"))).toBe(true);
    expect(result.tasks.map((task) => task.sectionId)).toEqual(["policy", "market"]);
  });

  it("stops after two invalid responses without searching or persisting partial tasks", async () => {
    const f = fixture([{ overview: "Incomplete" }]);
    const result = await f.run("start");
    expect(result.errorCode).toBe("RESEARCH_NODE_STATE_INVALID");
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.search).not.toHaveBeenCalled();
    expect(result.tasks).toEqual([]); expect(result.sources).toEqual([]);
    expect(f.writes.every((snapshot) => snapshot.tasks.length === 0)).toBe(true);
    expect(result.modelCalls.map((call) => call.status)).toEqual(["failed", "failed"]);
  });

  it("does not treat a provider exception as a response validation failure", async () => {
    const f = fixture([new Error("provider unavailable"), validPlan]);
    const result = await f.run("start");
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled();
    expect(result.tasks).toEqual([]);
  });

  it("does not retry a persistence failure even when it carries a validation-like reason code", async () => {
    const f = fixture([validPlan]);
    const original = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (actor, request, state, done) => {
      if (!done && state.tasks.length > 0) throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
      return original(actor, request, state, done);
    });
    const result = await f.run("start");
    expect(result.errorCode).toBe("RESEARCH_NODE_STATE_INVALID");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled();
  });

  it("does not repair a provider exception that uses the same reason code as validation", async () => {
    const f = fixture([new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID"), validPlan]);
    const result = await f.run("start");
    expect(result.errorCode).toBe("RESEARCH_NODE_STATE_INVALID");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled();
  });

  it("does not continue repair when persisting the second model attempt fails", async () => {
    const f = fixture([{ overview: "Incomplete" }, validPlan]);
    const original = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (actor, request, state, done) => {
      if (!done && state.modelCalls.length === 2) throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
      return original(actor, request, state, done);
    });
    const result = await f.run("start");
    expect(result.errorCode).toBe("RESEARCH_NODE_STATE_INVALID");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled();
    expect(result.tasks).toEqual([]);
  });

  it("bounds raw invalid output and validation details supplied to the repair", async () => {
    const invalid = {
      ...validPlan,
      tasks: Array.from({ length: 60 }, (_, index) => ({ ...validPlan.tasks[0], ["unexpected-" + "x".repeat(1000) + index]: "y".repeat(1000) })),
    };
    expect(JSON.stringify(invalid).length).toBeGreaterThan(24000);
    const f = fixture([invalid, validPlan]);
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(f.complete).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(f.complete.mock.calls[1]![0].user).repair;
    expect(repair.previousOutput.length).toBeLessThanOrEqual(24000);
    expect(repair.issues.length).toBeGreaterThan(0);
    expect(repair.issues.length).toBeLessThanOrEqual(40);
    for (const issue of repair.issues as Array<{ message: string; path: Array<string | number> }>) {
      expect(issue.message.length).toBeLessThanOrEqual(500);
      for (const part of issue.path) if (typeof part === "string") expect(part.length).toBeLessThanOrEqual(100);
    }
    expect(result.tasks).toHaveLength(2);
  });

  it("accepts a valid first response with one model call", async () => {
    const f = fixture([validPlan]);
    const result = await f.run();
    expect(result.errorCode).toBeNull();
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.complete.mock.calls[0]![0].user).allowedSectionIds).toEqual(["policy", "market"]);
    expect(result.tasks).toHaveLength(2);
    expect(f.search).not.toHaveBeenCalled();
  });
});
