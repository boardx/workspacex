import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { DigitalReportNdjsonDecoder } from "../../src/application/interview/workflow/digital-report-stream";

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

  it("decodes only complete NDJSON events across arbitrary provider chunks", () => {
    const decoder = new DigitalReportNdjsonDecoder();
    expect(decoder.push('{"type":"meta","title":"江西')).toEqual([]);
    expect(decoder.push('足球报告","executiveSummary":"摘要"}\n{"type":"section","markdown":"## 基层')).toEqual([
      { type: "meta", title: "江西足球报告", executiveSummary: "摘要" },
    ]);
    expect(decoder.push('体系"}\n')).toEqual([{ type: "section", markdown: "## 基层体系" }]);
    expect(decoder.finish()).toEqual([]);
  });

  it("projects a durable in-flight report so refresh does not look empty", () => {
    const generation = interview.DigitalInterviewReportGeneration.parse({
      reportId: "report-f06", requestId: "request-f06", status: "running",
      title: "江西足球报告", executiveSummary: "摘要", markdown: "## 已生成段落",
      findings: [], errorCode: null, updatedAt: "2026-09-02T01:00:00.000Z",
    });
    expect(generation).toMatchObject({ status: "running", markdown: "## 已生成段落" });
  });
});
