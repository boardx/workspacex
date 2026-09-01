import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";

describe("F06 digital interview report contract", () => {
  it("requires an explicit versioned confirmation and traceable exploratory findings", () => {
    expect(interview.operations.generateDigitalInterviewReport.in.parse({
      interviewId: "itv-f06", expectedVersion: 12, requestId: "report-request-f06",
    })).toEqual({ interviewId: "itv-f06", expectedVersion: 12, requestId: "report-request-f06" });
    expect(interview.DigitalInterviewReport.parse({
      reportId: "report-f06",
      title: "江西足球访谈报告",
      executiveSummary: "多位专家认为基层体系与赛事体系需要协同推进。",
      markdown: "# 江西足球访谈报告\n\n探索性结论。",
      findings: [{
        findingId: "finding-f06", title: "基层体系优先", summary: "回答建议先建设教练培养体系。",
        expertId: "expert-f06", questionId: "question-f06",
        sourceAnswerId: "expert-f06:question-f06", exploratory: true,
      }],
      generatedAt: "2026-09-01T02:00:00.000Z",
    }).findings[0]).toMatchObject({ expertId: "expert-f06", questionId: "question-f06", exploratory: true });
  });
});
