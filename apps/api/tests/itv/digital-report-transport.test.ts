import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { interview as C } from "@repo/contracts";
import { DigitalReportTransportProjector } from "../../src/application/interview/workflow/digital-report-transport";

type Workflow = z.infer<typeof C.DigitalInterviewWorkflowView>;

const base = {
  interviewId: "itv-delta", name: "AI 软件开发", tags: ["AI"], topic: "如何创新", status: "report_pending",
  sourceQuickInterviewId: null, selectedExpertIds: ["expert-1"], reportId: "report-1", version: 8,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "report", revisionId: "revision-1",
  topicVersionId: "topic-1", expertSnapshotVersionId: "experts-1", questionVersionId: "questions-1",
  expertCandidates: [{ marker: "must-not-be-streamed" }], questions: [{ marker: "must-not-be-streamed" }],
  questionCandidates: [{ marker: "must-not-be-streamed" }], expertRuns: [{ marker: "must-not-be-streamed" }],
  report: null, skillThreadId: "thread-1", skillMessages: [], skillProposals: [],
} as unknown as Workflow;

function running(markdown: string, findings: NonNullable<Workflow["reportGeneration"]>["findings"] = []): Workflow {
  return {
    ...base,
    reportGeneration: {
      reportId: "report-1", requestId: "request-1", status: "running", title: "AI 创新报告",
      executiveSummary: "聚焦工程效率。", markdown, findings, errorCode: null,
      updatedAt: "2026-09-03T06:00:00.000Z",
    },
  };
}

describe("数字访谈报告浏览器增量流", () => {
  it("只发一次轻量 snapshot，后续 section 只包含新增后缀", () => {
    const projector = new DigitalReportTransportProjector();
    const snapshot = projector.project(running("## 第一章"));
    const delta = projector.project(running("## 第一章\n\n## 第二章"));

    expect(snapshot).toEqual([expect.objectContaining({ type: "snapshot", seq: 0, markdown: "## 第一章" })]);
    expect(snapshot[0]).not.toHaveProperty("expertCandidates");
    expect(snapshot[0]).not.toHaveProperty("questions");
    expect(snapshot[0]).not.toHaveProperty("expertRuns");
    expect(delta).toEqual([{ type: "section", seq: 1, markdown: "\n\n## 第二章" }]);
    expect(JSON.stringify(delta)).not.toContain("第一章");
  });

  it("finding 逐条追加，完成帧只携带定位终态所需的标识", () => {
    const finding = {
      findingId: "finding-1", title: "开发者掌控", summary: "需要可解释上下文。",
      expertId: "expert-1", questionId: "question-1", sourceAnswerId: "expert-1:question-1", exploratory: true as const,
    };
    const projector = new DigitalReportTransportProjector();
    projector.project(running(""));
    expect(projector.project(running("", [finding]))).toEqual([{ type: "finding", seq: 1, finding }]);

    const completed = {
      ...base, status: "completed", currentStep: "report", version: 9, reportGeneration: null,
      report: { reportId: "report-1", title: "AI 创新报告", executiveSummary: "聚焦工程效率。",
        markdown: "", findings: [finding], generatedAt: "2026-09-03T06:01:00.000Z" },
    } as unknown as Workflow;
    expect(projector.project(completed)).toEqual([{ type: "complete", seq: 2, reportId: "report-1", version: 9 }]);
  });
});
