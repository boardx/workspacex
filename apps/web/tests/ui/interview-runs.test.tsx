import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { interview } from "@repo/contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";

type View = z.infer<typeof interview.DigitalInterviewWorkflowView>;

const view: View = {
  interviewId: "itv-f05", name: "江西足球", tags: ["足球"], topic: "江西足球的崛起",
  status: "running", sourceQuickInterviewId: null, selectedExpertIds: ["expert-a", "expert-b"],
  reportId: null, version: 12, scope: { kind: "none", projectId: null, researchProjectId: null },
  currentStep: "runs", revisionId: "revision-f05", topicVersionId: "topic-v1",
  expertSnapshotVersionId: "experts-v1", questionVersionId: "questions-v1",
  expertCandidates: [], questions: [], questionCandidates: [], skillThreadId: "skill-thread-f05",
  skillMessages: [], skillProposals: [], expertRuns: [
    { expertId: "expert-a", displayName: "青训专家", status: "completed", completedQuestions: 1,
      totalQuestions: 1, answers: [{ questionId: "q1", question: "如何建设青训？", answer: "我建议建立长期梯队。" }],
      errorCode: null, updatedAt: "2026-08-30T00:00:00.000Z" },
    { expertId: "expert-b", displayName: "产业专家", status: "failed", completedQuestions: 0,
      totalQuestions: 1, answers: [], errorCode: "MODEL_CALL_FAILED", updatedAt: "2026-08-30T00:00:01.000Z" },
  ],
};

describe("F05 expert run recovery UI", () => {
  it("shows each expert's independent progress, answers and failure", () => {
    render(<PersistentDigitalInterviewWorkflow initialView={view} />);
    expect(screen.getByText("青训专家")).toBeInTheDocument();
    expect(screen.getByText("我建议建立长期梯队。")).toBeInTheDocument();
    expect(screen.getByText("产业专家")).toBeInTheDocument();
    expect(screen.getByText("MODEL_CALL_FAILED")).toBeInTheDocument();
    expect(screen.getAllByTestId("itv-expert-run")).toHaveLength(2);
  });
});
