import { describe, expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { initialRuntime } from "../../src/application/research/guided-runtime-service";
import { projectResearchTrust } from "../../src/application/research/guided-research-trust";

const session = C.GuidedResearchSession.parse({
  sessionId: "trust-1", title: "Trust", tags: [],
  brief: { topic: "Market", goal: "Decide", timeRange: "2026", region: "Global", focus: "Evidence" },
  stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null,
  createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
});

function fixture() {
  return {
    ...initialRuntime(session),
    currentNode: "report" as const,
    availableNodes: C.ResearchNode.options,
    outline: [{ id: "s1", title: "Finding", questions: ["What is true?"], enabled: true, order: 0 }],
    tasks: [{ id: "t1", sectionId: "s1", query: "official evidence", status: "succeeded" as const, attempts: 1, errorCode: null }],
    sources: [{ id: "src1", taskId: "t1", title: "Official", url: "https://example.com/report", content: "Primary evidence text", retrievedAt: "2026-09-24T00:00:00.000Z", decision: "accepted" as const,
      document: { url: "https://example.com/report", retrievedAt: "2026-09-24T00:00:00.000Z", text: "Primary evidence text", contentHash: "a".repeat(64), contentKind: "html" as const, truncated: false } }],
    report: { title: "Report", summary: "Summary", sections: [{ sectionId: "s1", body: "Supported statement [[source:src1]]", sourceIds: ["src1"] }] },
    questionEvidence: [{ questionId: "chapter:0/question:0", sectionId: "s1", sourceId: "src1", quote: "Primary evidence text", relevance: "direct" as const }],
  };
}

describe("research trust projection", () => {
  it("marks covered questions ready with traceable evidence", () => {
    const result = projectResearchTrust(fixture());
    expect(result.coverage[0]).toMatchObject({ status: "answered", evidenceIds: ["src1"] });
    expect(result.claimEvidence[0]).toMatchObject({ sourceId: "src1", quote: "Primary evidence text" });
    expect(result.publicationReadiness.status).toBe("ready");
  });

  it("keeps unsupported core questions limited", () => {
    const state = fixture();
    state.questionEvidence = [];
    const result = projectResearchTrust(state);
    expect(result.coverage[0]?.status).toBe("missing");
    expect(result.publicationReadiness.blockers).toContain("核心问题覆盖不足");
  });

  it("does not copy one chapter citation onto every question", () => {
    const state = fixture();
    state.outline[0]!.questions.push("What remains unknown?");
    const result = projectResearchTrust(state);
    expect(result.coverage.map((item) => item.status)).toEqual(["answered", "missing"]);
    expect(result.publicationReadiness.status).toBe("limited");
  });

  it("keeps a mixed supported and unsupported key claim limited", () => {
    const state = fixture();
    state.reportEvidenceWarnings = [{ batchIndex: 0, sourceIds: ["src1"], questionIds: ["chapter:0/question:0"], reason: "invalid_model_evidence" }];
    const result = projectResearchTrust(state);
    expect(result.coverage[0]?.status).toBe("weak");
    expect(result.publicationReadiness.blockers).toContain("关键结论缺少来源");
  });

  it("keeps severe open conflicts limited even with many sources", () => {
    const state = fixture();
    state.conflicts = [{ id: "conflict-1", claimIds: ["c1", "c2"], sourceIds: ["src1", "src2"], severity: "severe", status: "open", resolution: null }];
    const result = projectResearchTrust(state);
    expect(result.publicationReadiness).toMatchObject({ status: "limited" });
    expect(result.publicationReadiness.blockers).toContain("存在未解决的严重冲突");
  });

  it("uses null rather than zero when quality has no denominator", () => {
    const result = projectResearchTrust(initialRuntime(session));
    expect(result.qualityScore.overall).toBeNull();
    expect(result.publicationReadiness.status).toBe("limited");
  });
});
