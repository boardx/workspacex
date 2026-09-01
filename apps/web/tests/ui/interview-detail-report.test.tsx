import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";

const completed: DigitalInterviewWorkflowView = {
  interviewId: "itv-f06", name: "江西足球", tags: ["足球"], topic: "江西足球的崛起", status: "running",
  sourceQuickInterviewId: null, selectedExpertIds: ["expert-f06"], reportId: null, report: null, version: 12,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "runs", revisionId: "revision-f06",
  topicVersionId: "topic-f06", expertSnapshotVersionId: "experts-f06", questionVersionId: "questions-f06",
  expertCandidates: [], questions: [], questionCandidates: [], skillThreadId: "thread-f06", skillMessages: [], skillProposals: [],
  expertRuns: [{
    expertId: "expert-f06", displayName: "陈指导", status: "completed", completedQuestions: 1, totalQuestions: 1,
    answers: [{ questionId: "question-f06", question: "如何建设基层体系？", answer: "先培养教练，再连接赛事。" }],
    errorCode: null, updatedAt: "2026-09-01T02:00:00.000Z",
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("F06 interview answers to report", () => {
  it("shows the confirmation button and advances to a traceable report", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ expectedVersion: 12, requestId: expect.any(String) });
      return new Response(JSON.stringify({ ...completed, status: "completed", currentStep: "report", version: 13,
        reportId: "report-f06", report: { reportId: "report-f06", title: "江西足球访谈报告",
          executiveSummary: "基层体系需要教练与赛事协同。", markdown: "# 江西足球访谈报告",
          findings: [{ findingId: "finding-f06", title: "基层优先", summary: "先培养教练。", expertId: "expert-f06",
            questionId: "question-f06", sourceAnswerId: "expert-f06:question-f06", exploratory: true }],
          generatedAt: "2026-09-01T02:01:00.000Z" } }), { status: 201, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={completed} />);
    const button = screen.getByTestId("itv-confirm-answers-generate-report");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByTestId("itv-report")).toHaveTextContent("江西足球访谈报告");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
