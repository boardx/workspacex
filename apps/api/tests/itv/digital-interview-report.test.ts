import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import {
  buildDigitalInterviewReportSystemPrompt,
  DIGITAL_REPORT_REQUIRED_HEADINGS,
  DigitalReportNdjsonDecoder,
} from "../../src/application/interview/workflow/digital-report-stream";
import {
  assessInterviewReportAnalysis,
  INTERVIEW_REPORT_ANALYSIS_REQUIREMENTS,
} from "../../src/application/interview/workflow/digital-report-quality";

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
        sourceAnswerId: "expert-f06:question-f06", goalIds: ["goal-f06"], exploratory: true,
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

  it("accepts fenced, pretty-printed JSON events split across provider chunks", () => {
    const decoder = new DigitalReportNdjsonDecoder();
    expect(decoder.push('```ndjson\n{\n  "type": "meta",\n  "title": "江西')).toEqual([]);
    expect(decoder.push('足球报告",\n  "executiveSummary": "摘要"\n}\n```\n')).toEqual([
      { type: "meta", title: "江西足球报告", executiveSummary: "摘要" },
    ]);
    expect(decoder.finish()).toEqual([]);
  });

  it("normalizes malformed model events to a model-output syntax error", () => {
    const decoder = new DigitalReportNdjsonDecoder();
    expect(() => decoder.push('{"type":"section"}\n')).toThrowError(SyntaxError);
  });

  it("projects a durable in-flight report so refresh does not look empty", () => {
    const generation = interview.DigitalInterviewReportGeneration.parse({
      reportId: "report-f06", requestId: "request-f06", status: "running",
      title: "江西足球报告", executiveSummary: "摘要", markdown: "## 已生成段落",
      findings: [], errorCode: null, updatedAt: "2026-09-02T01:00:00.000Z",
    });
    expect(generation).toMatchObject({ status: "running", markdown: "## 已生成段落" });
  });

  it("requires a decision-grade user research structure instead of a generic summary", () => {
    const prompt = buildDigitalInterviewReportSystemPrompt(3);
    for (const heading of DIGITAL_REPORT_REQUIRED_HEADINGS) expect(prompt).toContain(heading);
    expect(prompt).toContain("画像关联");
    expect(prompt).toContain("受访者原意、研究者归纳和待验证推论");
    expect(prompt).toContain("P0/P1/P2");
    expect(prompt).toContain("至少 3 个 finding");
    expect(prompt).toContain("先输出 finding");
    expect(prompt).toContain("4000-8000 个中文字符");
    expect(prompt).toContain("数字专家模拟访谈");
    expect(prompt).toContain(INTERVIEW_REPORT_ANALYSIS_REQUIREMENTS);
  });

  it("accepts findings that connect evidence, interpretation, impact, and boundaries", () => {
    const report = [
      "## 关键发现",
      "### 跨角色综合",
      "证据：专家甲提到切换成本，专家乙补充审批延迟。",
      "分析：两条回答共同指向流程割裂，而不是单一功能缺失。",
      "决策影响：应优先验证统一入口，暂缓增加新的独立工具。",
      "边界与反例：当前仅覆盖两类角色，财务团队是否同样受影响仍待验证。",
      "## 分歧与反例",
      "专家丙认为现有流程可用，置信度为中，需补充真实任务数据。",
      "## 建议行动",
      "P0：用真实任务验证统一入口，成功信号为完成时长下降。",
    ].join("\n\n");

    expect(assessInterviewReportAnalysis(report)).toEqual({ ok: true, missing: [] });
  });

  it("rejects a transcript-like report even when it has report headings", () => {
    const report = [
      "## 关键发现",
      "专家甲说入口太多。专家乙说审批较慢。专家丙说希望更简单。",
      "## 分歧与反例",
      "专家回答有所不同。",
      "## 建议行动",
      "建议优化产品。",
    ].join("\n\n");

    expect(assessInterviewReportAnalysis(report)).toEqual({
      ok: false,
      missing: ["cross_answer_synthesis", "decision_implication", "boundary_or_counterevidence"],
    });
  });
});
