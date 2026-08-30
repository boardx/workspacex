import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";

describe("F05 digital interview expert runs", () => {
  it("keeps completed and failed experts independently recoverable", () => {
    const base = {
      interviewId: "itv-f05", name: "江西足球", tags: ["足球"], topic: "江西足球的崛起",
      status: "running", sourceQuickInterviewId: null, selectedExpertIds: ["expert-a", "expert-b"],
      reportId: null, version: 12, scope: { kind: "none", projectId: null, researchProjectId: null },
      currentStep: "runs", revisionId: "revision-f05", topicVersionId: "topic-v1",
      expertSnapshotVersionId: "experts-v1", questionVersionId: "questions-v1",
      expertCandidates: [], questions: [], questionCandidates: [], skillThreadId: "skill-thread-f05",
      skillMessages: [], skillProposals: [],
    } as const;
    const parsed = interview.DigitalInterviewWorkflowView.parse({ ...base, expertRuns: [
      { expertId: "expert-a", displayName: "青训专家", status: "completed", completedQuestions: 1,
        totalQuestions: 1, answers: [{ questionId: "q1", question: "如何建设青训？", answer: "我建议建立长期梯队。" }],
        errorCode: null, updatedAt: "2026-08-30T00:00:00.000Z" },
      { expertId: "expert-b", displayName: "产业专家", status: "failed", completedQuestions: 0,
        totalQuestions: 1, answers: [], errorCode: "MODEL_CALL_FAILED", updatedAt: "2026-08-30T00:00:01.000Z" },
    ] });
    expect(parsed.expertRuns[0]?.answers[0]?.answer).toContain("长期梯队");
    expect(parsed.expertRuns[1]).toMatchObject({ status: "failed", errorCode: "MODEL_CALL_FAILED" });
  });
});
