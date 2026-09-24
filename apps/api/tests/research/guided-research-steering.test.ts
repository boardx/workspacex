import { describe, expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { applyResearchSteering, initialRuntime } from "../../src/application/research/guided-runtime-service";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { assertInternalSourceAccess } from "../../src/application/research/guided-runtime-service";
import { decideRuntimeClaim } from "../../src/infrastructure/research/pg-guided-runtime-store";

const session = C.GuidedResearchSession.parse({
  sessionId: "session-1", title: "Research", tags: [],
  brief: { topic: "AI search", goal: "Choose", timeRange: "2026", region: "Global", focus: "Evidence" },
  stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0,
  reportId: null, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
});

function command(action: "pause" | "resume", expectedRevision = 0) {
  return C.GuidedResearchRuntimeCommand.parse({
    sessionId: session.sessionId, node: "research", action, requestId: `${action}-request`, expectedVersion: 0,
    expectedRevision, idempotencyKey: `${action}-key`,
  });
}
function researchRuntime(): ResearchRuntime {
  return { ...initialRuntime(session), currentNode: "research", availableNodes: ["brief", "directions", "outline", "research"], planRevision: 0 };
}

describe("guided research steering", () => {
  it("enforces restrict domains and biases prioritized searches", async () => {
    const { searchWithSourcePolicy } = await import("../../src/application/research/guided-runtime-service");
    const queries: string[] = [];
    const search = { search: async (query: string) => {
      queries.push(query);
      return [
      { title: query, url: "https://allowed.example/report", content: "ok" },
      { title: query, url: "https://blocked.example/report", content: "no" },
      ];
    } };
    const restricted = await searchWithSourcePolicy(search, "market", { mode: "restrict", domains: ["allowed.example"], internalSourceIds: [], revision: 1 });
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.url).toContain("allowed.example");
    const prioritized = await searchWithSourcePolicy(search, "market", { mode: "prioritize", domains: ["allowed.example"], internalSourceIds: [], revision: 1 });
    expect(prioritized[0]?.title).toContain("site:allowed.example");
    expect(queries.at(-1)).toBe("market");
    expect(prioritized.map((hit) => hit.url)).toEqual([
      "https://allowed.example/report",
      "https://blocked.example/report",
    ]);
  });
  it("rejects stale revisions without mutating state", () => {
    const state = { ...initialRuntime(session), planRevision: 2 };
    expect(() => applyResearchSteering(state, command("pause", 1), "2026-09-24T00:00:00.000Z"))
      .toThrowError("RESEARCH_REVISION_CONFLICT");
    expect(state.controlStatus).toBeUndefined();
  });

  it("deduplicates retried steering commands", () => {
    const state = researchRuntime();
    applyResearchSteering(state, command("pause"), "2026-09-24T00:00:00.000Z");
    applyResearchSteering(state, command("pause"), "2026-09-24T00:01:00.000Z");
    expect(state.controlStatus).toBe("paused");
    expect(state.activity).toHaveLength(1);
  });

  it("rejects unverified internal sources atomically", () => {
    const state = researchRuntime();
    const policyCommand = C.GuidedResearchRuntimeCommand.parse({
      sessionId: session.sessionId, node: "research", action: "refine_source_policy", requestId: "policy-request",
      expectedVersion: 0, expectedRevision: 0, idempotencyKey: "policy-key",
      sourcePolicy: { mode: "restrict", domains: ["example.com"], internalSourceIds: ["private-1"], revision: 1 },
    });
    expect(() => assertInternalSourceAccess(policyCommand.sourcePolicy!.internalSourceIds, []))
      .toThrowError("RESEARCH_SOURCE_ACCESS_DENIED");
    expect(state.sourcePolicy).toBeUndefined();
  });

  it("allows internal sources authorized by the access port", () => {
    expect(() => assertInternalSourceAccess(["private-1"], ["private-1"])).not.toThrow();
    expect(() => assertInternalSourceAccess(["private-1"], [])).toThrowError("RESEARCH_SOURCE_ACCESS_DENIED");
  });

  it("invalidates every downstream result when the decision scope changes", () => {
    const state = researchRuntime();
    state.intent = { decision: "Old decision", successCriteria: ["Old criterion"], audience: "Leadership", deliverable: "Decision memo", timeframe: { from: "2024-01-01", to: "2025-01-01" } };
    state.tasks = [{ id: "task-1", sectionId: "section-1", query: "old", status: "succeeded", attempts: 1, errorCode: null }];
    state.sources = [{ id: "source-1", taskId: "task-1", title: "Old", url: "https://example.com/old", content: "Old evidence", retrievedAt: "now", decision: "accepted" }];
    state.report = { title: "Old report", summary: "Old", sections: [] };
    state.completed = true;
    applyResearchSteering(state, C.GuidedResearchRuntimeCommand.parse({
      sessionId: session.sessionId, node: "research", action: "refine_scope", requestId: "scope-request",
      expectedVersion: 0, expectedRevision: 0, idempotencyKey: "scope-key",
      intent: { decision: "New decision", successCriteria: ["New criterion"], audience: "Leadership", deliverable: "Decision memo", timeframe: { from: "2025-01-02", to: "2026-01-01" } },
    }), "2026-09-24T00:00:00.000Z");
    expect(state).toMatchObject({ currentNode: "research", tasks: [], sources: [], report: null, completed: false });
  });

  it("replays an identical committed request before checking its stale revision", () => {
    const state = { ...researchRuntime(), planRevision: 1 };
    const replay = decideRuntimeClaim(state, { "pause-request": { hash: "same", done: true } }, command("pause", 0), "same");
    expect(replay).toEqual({ replay: true });
  });
});
