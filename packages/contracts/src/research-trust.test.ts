import { describe, expect, it } from "vitest";
import * as research from "./research";

function legacyRuntimeFixture() {
  return {
    sessionId: "session-1",
    version: 1,
    revision: 1,
    currentNode: "brief",
    availableNodes: ["brief"],
    brief: { topic: "AI search", goal: "Choose a vendor", timeRange: "2026", region: "Global", focus: "Evidence" },
    directions: [],
    outline: [],
    tasks: [],
    sources: [],
    report: null,
    completed: false,
    busy: false,
    leaseUntil: null,
    errorCode: null,
    generatedNodes: [],
    messages: [],
    proposal: null,
    modelCalls: [],
  };
}

describe("guided research trust contracts", () => {
  it("parses a legacy runtime without claiming publication readiness", () => {
    const parsed = research.GuidedResearchRuntime.parse(legacyRuntimeFixture());
    expect(parsed.publicationReadiness).toBeUndefined();
    expect(parsed.qualityScore).toBeUndefined();
  });

  it("keeps unknown quality distinct from zero", () => {
    const parsed = research.GuidedResearchQualityScore.parse({
      citationCoverage: null,
      authority: null,
      recency: null,
      crossValidation: null,
      openGapCount: 0,
      overall: null,
      explanations: [],
    });
    expect(parsed.overall).toBeNull();
  });

  it("rejects unknown source policy fields", () => {
    expect(() => research.GuidedResearchSourcePolicy.parse({
      mode: "open",
      domains: [],
      internalSourceIds: [],
      revision: 0,
      bypassAuthorization: true,
    })).toThrow();
  });

  it("requires steering commands to carry revision and idempotency data", () => {
    const parsed = research.GuidedResearchRuntimeCommand.parse({
      sessionId: "session-1",
      node: "research",
      action: "pause",
      requestId: "request-1",
      expectedVersion: 1,
      expectedRevision: 2,
      idempotencyKey: "pause-1",
    });
    expect(parsed.action).toBe("pause");
  });
});
