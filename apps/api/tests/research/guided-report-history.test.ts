import { describe, expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { initialRuntime } from "../../src/application/research/guided-runtime-service";
import { preservePreviousReport } from "../../src/application/research/guided-report-history";

function fixture() {
  const state = initialRuntime(C.GuidedResearchSession.parse({ sessionId: "s", title: "Policy", brief: { topic: "Policy", goal: "Compare", region: "EU", focus: "Grid", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" }));
  state.outline = [{ id: "o", title: "Original title", questions: ["Which policy?"], enabled: true, order: 0 }];
  state.sources = [{ id: "source", taskId: "t", title: "Policy", url: "https://example.org/policy", content: "Evidence ".repeat(100), retrievedAt: "now", decision: "accepted" }];
  state.reportSourceAliases = [{ alias: "S1", sourceId: "source" }];
  state.report = { title: "Previous report", summary: "Original summary", sections: [{ sectionId: "o", body: "Prior findings [[source:source]]", sourceIds: ["source"] }] };
  return state;
}

describe("previous report snapshot", () => {
  it("retains a detached report with its original titles, sources and alias map", () => {
    const state = fixture();
    state.reportPartial = true;
    state.reportEvidenceWarnings = [{ batchIndex: 0, sourceIds: ["source"], questionIds: ["q"], reason: "invalid_model_evidence" }];
    preservePreviousReport(state);
    state.reportEvidenceWarnings = [];
    state.report!.summary = "Changed"; state.sources[0]!.decision = "excluded";
    state.outline[0]!.title = "Changed title"; state.reportSourceAliases![0]!.sourceId = "new";
    const history = C.GuidedResearchPreviousReport.parse(state.reportPrevious);
    expect(history.partial).toBe(true);
    expect(history.evidenceWarnings).toHaveLength(1);
    expect(history.report?.summary).toBe("Original summary");
    expect(history.sources[0]?.decision).toBe("accepted");
    expect(history.sources[0]?.content).toHaveLength(600);
    expect(history.outline[0]?.title).toBe("Original title");
    expect(history.aliases[0]?.sourceId).toBe("source");
  });
  it("does not replace visible history with an empty failed attempt", () => {
    const state = fixture(); preservePreviousReport(state);
    const previous = structuredClone(state.reportPrevious);
    state.report = null; state.reportCheckpoint = { basis: "new", chapters: [] };
    state.reportStream = { requestId: "new", sequence: 1, text: '{"sections":[', status: "failed" };
    preservePreviousReport(state);
    expect(state.reportPrevious).toEqual(previous);
    expect(state.report).toBeNull(); expect(state.reportCheckpoint.chapters).toEqual([]);
  });
  it("retains unvalidated streamed chapters without promoting them into saved chapters", () => {
    const state = fixture(); state.report = null;
    state.reportStream = { requestId: "old", sequence: 1, text: '{"sections":[{"sectionId":"o","body":"Unfinished body', status: "failed" };
    preservePreviousReport(state);
    expect(state.reportPrevious?.text).toContain("Unfinished body");
    expect(state.reportPrevious?.chapters).toEqual([]);
    expect(state.reportPrevious?.report).toBeNull();
    expect(state.reportCheckpoint).toBeUndefined();
  });
  it("retains only the latest nonempty attempt and accepts old runtimes without history fields", () => {
    const state = fixture(); expect(C.GuidedResearchRuntime.safeParse(state).success).toBe(true);
    preservePreviousReport(state);
    state.report = null; state.reportCheckpoint = { basis: "current", chapters: [{ sectionId: "o", body: "New saved chapter", sourceIds: [] }] };
    preservePreviousReport(state);
    expect(state.reportPrevious?.chapters[0]?.body).toBe("New saved chapter");
    expect(state.reportPrevious?.report).toBeNull();
  });
});
