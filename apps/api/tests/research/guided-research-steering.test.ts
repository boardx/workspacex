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

  it("replays an identical committed request before checking its stale revision", () => {
    const state = { ...researchRuntime(), planRevision: 1 };
    const replay = decideRuntimeClaim(state, { "pause-request": { hash: "same", done: true } }, command("pause", 0), "same");
    expect(replay).toEqual({ replay: true });
  });
});
