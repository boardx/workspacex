import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";

const baseWorkflow = {
  interviewId: "itv-evidence", name: "访谈", tags: ["研究"], topic: "验证假设", status: "completed",
  sourceQuickInterviewId: null, selectedExpertIds: ["expert-a"], reportId: "report-a", version: 1,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "report", revisionId: "revision-a",
  topicVersionId: "topic-a", expertSnapshotVersionId: "experts-a", questionVersionId: "questions-a",
  expertCandidates: [], questions: [], questionCandidates: [], expertRuns: [], skillThreadId: "thread-a", skillMessages: [], skillProposals: [], reportGeneration: null,
  report: {
    reportId: "report-a", title: "探索报告", executiveSummary: "仍需真实访谈验证。", markdown: "## 发现",
    generatedAt: "2026-09-25T00:00:00.000Z",
    findings: [{
      findingId: "finding-a", title: "发现", summary: "模拟专家观点。", expertId: "expert-a", questionId: "question-a",
      sourceAnswerId: "expert-a:question-a", exploratory: true,
      evidenceStatus: "exploratory", counterEvidenceCount: 0,
      evidenceRefs: [{ sourceKind: "digital_expert", sourceAnswerId: "expert-a:question-a", expertId: "expert-a", participantId: null, questionId: "question-a", revisionId: "revision-a" }],
    }],
  },
} as const;

describe("digital interview report evidence contract", () => {
  it("exposes simulation evidence and source-bound exploratory findings", () => {
    expect(interview.DigitalInterviewWorkflowView.parse({
      ...baseWorkflow,
      studyEvidenceMode: "simulated",
      reportReview: {
        eligibility: "blocked_missing_participant_evidence",
        message: "需要真实受访者证据后才能批准。",
        action: "添加并复核真实受访者回答",
      },
    })).toMatchObject({
      studyEvidenceMode: "simulated",
      report: { findings: [{ evidenceStatus: "exploratory", counterEvidenceCount: 0, evidenceRefs: [{ sourceKind: "digital_expert", sourceAnswerId: "expert-a:question-a" }] }] },
    });
  });
});
