import { describe, expect, it } from "vitest";
import { SurveyTemplateInputSchema, SurveyTemplateSaveInputSchema, SURVEY_TEMPLATE_REQUEST_MAX_BYTES } from "@repo/contracts/survey-template-library";
import { SurveyDraftInputSchema } from "@repo/contracts/survey-runtime";
import { compileSurveyReport } from "@repo/contracts/survey-report";
import type { survey } from "@repo/contracts";
import { getBuiltinSurveyTemplate, getBuiltinSurveyTemplates } from "@/lib/survey/builtin-templates";
import { getSurveyReferenceQuestions, getSurveyReferenceReportSections } from "@/lib/survey/template-content";
import { createSurveyWorkflowMock, getPublishBlockers } from "@/lib/survey/workflow-model";
import { SURVEY_QUESTION_MODULE_CARDS, SURVEY_TEMPLATE_CARDS } from "@/lib/survey/resource-library";

function submittedAnswers(questions: survey.SurveyWorkflowQuestion[]): survey.SurveyResponse[] {
  // Test-only, explicitly submitted answers; the catalog contains no respondent data.
  return [2, 4].map((score, index) => ({
    id: `test-submission-${index}`, quality: "normal", role: "测试提交人", companySize: "测试组织",
    submittedAt: `2026-09-${20 + index}T00:00:00.000Z`, durationSeconds: 60,
    answers: questions.map(question => ({ questionId: question.id, value: question.type === "scale" ? String(score) : question.type === "open" ? "受访者实际填写的建议" : question.options[index % question.options.length]! })),
  }));
}
describe("built-in survey content", () => {
  it("restores six original question modules and four original report names/section slices", () => {
    const modules = getBuiltinSurveyTemplates("question");
    expect(modules.map(item => item.id)).toEqual(["builtin-profile", "builtin-strategy", "builtin-collaboration", "builtin-knowledge", "builtin-data", "builtin-tools"]);
    expect(modules.map(item => item.title)).toEqual(SURVEY_QUESTION_MODULE_CARDS.map(item => item.title));
    expect(modules.map(item => item.questions.length)).toEqual([3, 3, 2, 2, 2, 2]);
    const reports = getBuiltinSurveyTemplates("report");
    expect(reports.map(item => item.id)).toEqual(SURVEY_TEMPLATE_CARDS.map(item => `builtin-${item.id}`));
    expect(reports.map(item => item.title)).toEqual(SURVEY_TEMPLATE_CARDS.map(item => item.title));
    expect(reports.map(item => item.template.sections.length)).toEqual([8, 6, 5, 8]);
    reports.forEach((item, index) => {
      expect(item.questions).toHaveLength(16);
      expect(item.template.sections.map(section => section.title)).toEqual(getSurveyReferenceReportSections().slice(0, SURVEY_TEMPLATE_CARDS[index]!.reportSectionCount).map(section => section.title));
    });
  });
  it("provides bounded, publishable real inputs with valid typed question references", () => {
    for (const kind of ["question", "report"] as const) for (const item of getBuiltinSurveyTemplates(kind)) {
      expect(SurveyTemplateInputSchema.safeParse(item).success, item.id).toBe(true);
      expect(SurveyTemplateSaveInputSchema.safeParse({ ...item, expectedVersion: 1 }).success, item.id).toBe(true);
      expect(SurveyDraftInputSchema.safeParse({ title: item.title, questions: item.questions, template: item.template }).success).toBe(true);
      expect(new TextEncoder().encode(JSON.stringify(item)).byteLength).toBeLessThan(SURVEY_TEMPLATE_REQUEST_MAX_BYTES - 128);
      for (const q of item.questions) {
        expect(q.chapterId).not.toBe("");
        if (q.type === "scale") expect(q.options).toEqual(["1", "2", "3", "4", "5"]);
      }
      for (const section of item.template.sections) for (const block of section.blocks) {
        const bound = block.questionIds.map(id => item.questions.find(q => q.id === id));
        expect(bound.every(Boolean)).toBe(true);
        if (block.type !== "text" && block.statistic === "mean") expect(bound.every(q => q!.type === "scale")).toBe(true);
        if (block.statistic === "distribution") expect(bound.every(q => q!.type !== "open")).toBe(true);
        expect(block.target).toBeUndefined();
        if (block.type === "text") expect(block.text).not.toMatch(/编辑指引|请在|待分析|建议方法/);
      }
      expect(Object.keys(item).sort()).toEqual(["description", "id", "kind", "questions", "template", "title"]);
      expect(JSON.stringify(item)).not.toMatch(/R-000|模拟答卷|系统集成差距为|62 份|survey\.boardx\.test/);
    }
  });
  it("compiles every built-in from supplied answer fixtures, with actual numeric data", () => {
    for (const kind of ["question", "report"] as const) for (const item of getBuiltinSurveyTemplates(kind)) {
      const original = compileSurveyReport(item.template, item.questions, submittedAnswers(item.questions));
      const body = original.sections.flatMap(section => section.blocks.map(block => block.text ?? "")).join("\n");
      expect(body).not.toMatch(/编辑指引|请在|待分析|建议方法/);
      if (kind === "report") {
        expect(original.issues.length).toBeGreaterThan(0);
        expect(item.description).toContain("方法：");
      }
      // Explicit author content in a test fixture, never part of the built-in catalog.
      const authored = structuredClone(item.template);
      for (const section of authored.sections) for (const block of section.blocks) {
        if (block.type === "text" && !block.text?.trim()) block.text = "本次两份有效答卷的量表均值为3分；仅描述当前样本，不推断原因或行动效果。";
      }
      const report = compileSurveyReport(authored, item.questions, submittedAnswers(item.questions));
      expect(report.issues, item.id).toEqual([]);
      const blocks = report.sections.flatMap(section => section.blocks).filter(block => block.type !== "text");
      expect(blocks.length, item.id).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.issues).toEqual([]);
        expect(block.rows.length).toBeGreaterThan(0);
        if (block.statistic === "mean" && block.type !== "line") expect(block.rows.every(row => row.value === 3)).toBe(true);
      }
      expect(compileSurveyReport(item.template, item.questions, []).issues.length).toBeGreaterThan(0);
    }
  });
  it("keeps method prose true after changing scale domains and sample policies", () => {
    const item = getBuiltinSurveyTemplate("builtin-tpl-digital-collaboration", "report")!;
    const questions = item.questions.map(question => question.type === "scale"
      ? { ...question, options: Array.from({ length: 10 }, (_, index) => String(index + 1)) }
      : question);
    const template = structuredClone(item.template);
    for (const section of template.sections) for (const block of section.blocks) {
      block.samplePolicy = "all";
      block.minGroupSize = 10;
      if (block.type === "text" && !block.text) block.text = "本节内容由报告作者根据实际数据填写。";
    }
    const responses = submittedAnswers(questions).map((response, index) => ({
      ...response, quality: index === 0 ? "review" as const : "normal" as const,
      answers: response.answers.map(answer => questions.find(q => q.id === answer.questionId)!.type === "scale"
        ? { ...answer, value: index === 0 ? "8" : "10" } : answer),
    }));
    const compiled = compileSurveyReport(template, questions, responses);
    expect(compiled.issues).toEqual([]);
    const summary = compiled.sections.find(section => section.id === "summary")!;
    expect(summary.blocks[0]!.rows.every(row => row.value === 9 && row.count === 2)).toBe(true);
    const method = compiled.sections.find(section => section.id === "boundary")!.blocks[0]!.text!;
    expect(method).toContain("按对应题目的量表选项计分");
    expect(method).not.toMatch(/1至5|1[–-]5|未标记|待复核|仅正常|至少.?5|均值|算术/);
  });

  it("isolates editable copies and preserves the original mock publication blockers", () => {
    const first = getBuiltinSurveyTemplates("report");
    first[0]!.questions[0]!.options[0] = "changed";
    first[0]!.template.sections[0]!.blocks[0]!.text = "changed";
    expect(first[1]!.questions[0]!.options[0]).not.toBe("changed");
    expect(getBuiltinSurveyTemplate(first[0]!.id, "report")!.questions[0]!.options[0]).not.toBe("changed");
    expect(getBuiltinSurveyTemplate(first[0]!.id, "report")!.template.sections[0]!.blocks[0]!.text).not.toBe("changed");
    expect(getBuiltinSurveyTemplate(first[0]!.id, "question")).toBeUndefined();
    expect(getBuiltinSurveyTemplate("unknown", "report")).toBeUndefined();
    const mock = createSurveyWorkflowMock();
    expect(mock.questions).toEqual(getSurveyReferenceQuestions());
    expect(mock.reportTemplate.sections).toEqual(getSurveyReferenceReportSections());
    expect(mock.questions.find(q => q.id === "Q15")!.options).toEqual([]);
    expect(mock.questions.find(q => q.id === "Q16")!.chapterId).toBe("");
    expect(getPublishBlockers(mock).map(blocker => blocker.code)).toEqual(["QUESTION_OPTIONS_EMPTY", "MAPPING_INCOMPLETE"]);
  });
});
