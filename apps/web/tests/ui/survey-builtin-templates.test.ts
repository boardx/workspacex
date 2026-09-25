import { describe, expect, it } from "vitest";
import {
  SurveyTemplateInputSchema,
  SurveyTemplateSaveInputSchema,
  SURVEY_TEMPLATE_REQUEST_MAX_BYTES,
} from "@repo/contracts/survey-template-library";
import { SurveyDraftInputSchema } from "@repo/contracts/survey-runtime";
import { compileSurveyReport } from "@repo/contracts/survey-report";
import type { survey } from "@repo/contracts";
import {
  getBuiltinSurveyTemplate,
  getBuiltinSurveyTemplates,
} from "@/lib/survey/builtin-templates";
import {
  getSurveyReferenceQuestions,
  getSurveyReferenceReportSections,
} from "@/lib/survey/template-content";
import {
  createSurveyWorkflowMock,
  getPublishBlockers,
} from "@/lib/survey/workflow-model";
import {
  surveyChoices,
  surveyQuestionStatistics,
  validateSurveyQuestions,
} from "@repo/contracts/survey";
import { SURVEY_SCENARIOS } from "@/lib/survey/scenario-templates";
import { SURVEY_QUESTION_MODULE_CARDS } from "@/lib/survey/resource-library";

function submittedAnswers(
  questions: survey.SurveyWorkflowQuestion[],
): survey.SurveyResponse[] {
  // Test-only, explicitly submitted answers; the catalog contains no respondent data.
  return [2, 4].map((score, index) => ({
    id: `test-submission-${index}`,
    quality: "normal",
    role: "测试提交人",
    companySize: "测试组织",
    submittedAt: `2026-09-${20 + index}T00:00:00.000Z`,
    durationSeconds: 60,
    answers: questions.map((question) => {
      const choices = surveyChoices(question).map((choice) => choice.id);
      let value: survey.SurveyAnswerValue = String(score);
      if (["open", "short"].includes(question.type))
        value = "受访者实际填写的建议";
      else if (question.type === "date") value = "2026-09-21";
      else if (question.type === "ranking") value = choices;
      else if (question.type === "multi")
        value = [choices[index % choices.length]!];
      else if (["single", "dropdown"].includes(question.type))
        value = choices[index % choices.length]!;
      return { questionId: question.id, value };
    }),
  }));
}
describe("built-in survey content", () => {
  it("retains six modules and adds six distinct complete questionnaires and reports", () => {
    const all = getBuiltinSurveyTemplates("question");
    const modules = all.filter(
      (item) => !item.id.startsWith("builtin-survey-"),
    );
    expect(modules.map((item) => item.id)).toEqual([
      "builtin-profile",
      "builtin-strategy",
      "builtin-collaboration",
      "builtin-knowledge",
      "builtin-data",
      "builtin-tools",
    ]);
    expect(modules.map((item) => item.title)).toEqual(
      SURVEY_QUESTION_MODULE_CARDS.map((item) => item.title),
    );
    expect(modules.map((item) => item.questions.length)).toEqual([
      3, 3, 2, 2, 2, 2,
    ]);
    const complete = all.filter((item) =>
      item.id.startsWith("builtin-survey-"),
    );
    expect(complete).toHaveLength(6);
    expect(complete.map((item) => item.questions.length)).toEqual([
      16, 20, 12, 18, 8, 24,
    ]);
    const reports = getBuiltinSurveyTemplates("report");
    expect(reports.map((item) => item.id)).toEqual(
      SURVEY_SCENARIOS.map((item) => `builtin-tpl-${item.id}`),
    );
    expect(
      new Set(reports.map((item) => JSON.stringify(item.questions))).size,
    ).toBe(6);
    for (const item of all)
      expect(validateSurveyQuestions(item.questions), item.id).toEqual([]);
  });
  it("provides bounded, publishable real inputs with valid typed question references", () => {
    for (const kind of ["question", "report"] as const)
      for (const item of getBuiltinSurveyTemplates(kind)) {
        expect(SurveyTemplateInputSchema.safeParse(item).success, item.id).toBe(
          true,
        );
        expect(
          SurveyTemplateSaveInputSchema.safeParse({
            ...item,
            expectedVersion: 1,
          }).success,
          item.id,
        ).toBe(true);
        expect(
          SurveyDraftInputSchema.safeParse({
            title: item.title,
            questions: item.questions,
            template: item.template,
          }).success,
        ).toBe(true);
        expect(
          new TextEncoder().encode(JSON.stringify(item)).byteLength,
        ).toBeLessThan(SURVEY_TEMPLATE_REQUEST_MAX_BYTES - 128);
        for (const q of item.questions) {
          expect(q.chapterId).not.toBe("");
          if (q.type === "scale")
            expect(q.options).toEqual(["1", "2", "3", "4", "5"]);
        }
        for (const section of item.template.sections)
          for (const block of section.blocks) {
            const bound = block.questionIds.map((id) =>
              item.questions.find((q) => q.id === id),
            );
            expect(bound.every(Boolean)).toBe(true);
            if (block.type !== "text" && block.statistic === "mean")
              expect(
                bound.every((q) =>
                  surveyQuestionStatistics(q!).includes("mean"),
                ),
              ).toBe(true);
            if (block.statistic === "distribution")
              expect(bound.every((q) => q!.type !== "open")).toBe(true);
            expect(block.target).toBeUndefined();
            if (block.type === "text")
              expect(block.text).not.toMatch(/编辑指引|请在|待分析|建议方法/);
          }
        expect(Object.keys(item).sort()).toEqual([
          "description",
          "id",
          "kind",
          "questions",
          "template",
          "title",
        ]);
        expect(JSON.stringify(item)).not.toMatch(
          /R-000|模拟答卷|系统集成差距为|62 份|survey\.boardx\.test/,
        );
      }
  });
  it("compiles every built-in from supplied answer fixtures, with actual numeric data", () => {
    for (const kind of ["question", "report"] as const)
      for (const item of getBuiltinSurveyTemplates(kind)) {
        const original = compileSurveyReport(
          item.template,
          item.questions,
          submittedAnswers(item.questions),
        );
        const body = original.sections
          .flatMap((section) => section.blocks.map((block) => block.text ?? ""))
          .join("\n");
        expect(body).not.toMatch(/编辑指引|请在|待分析|建议方法/);
        // Explicit author content in a test fixture, never part of the built-in catalog.
        const authored = structuredClone(item.template);
        for (const section of authored.sections)
          for (const block of section.blocks) {
            if (block.type === "text" && !block.text?.trim())
              block.text =
                "本次两份有效答卷的量表均值为3分；仅描述当前样本，不推断原因或行动效果。";
          }
        const report = compileSurveyReport(
          authored,
          item.questions,
          submittedAnswers(item.questions),
        );
        expect(report.issues, item.id).toEqual([]);
        const blocks = report.sections
          .flatMap((section) => section.blocks)
          .filter((block) => block.type !== "text");
        expect(blocks.length, item.id).toBeGreaterThan(0);
        for (const block of blocks) {
          expect(block.issues).toEqual([]);
          expect(
            block.rows.length + (block.answerTexts?.length ?? 0),
          ).toBeGreaterThan(0);
          if (block.statistic === "mean" && block.type !== "line")
            expect(block.rows.every((row) => row.value === 3)).toBe(true);
        }
        expect(
          compileSurveyReport(item.template, item.questions, []).issues.length,
        ).toBeGreaterThan(0);
      }
  });
  it("keeps method prose true after changing scale domains and sample policies", () => {
    const item = getBuiltinSurveyTemplate(
      "builtin-tpl-digital-collaboration",
      "report",
    )!;
    const questions = item.questions.map((question) =>
      question.type === "scale"
        ? {
            ...question,
            config: { ...question.config, max: 10 },
            options: Array.from({ length: 10 }, (_, index) =>
              String(index + 1),
            ),
          }
        : question,
    );
    const template = structuredClone(item.template);
    for (const section of template.sections)
      for (const block of section.blocks) {
        block.samplePolicy = "all";
        block.minGroupSize = 10;
        if (block.type === "text" && !block.text)
          block.text = "本节内容由报告作者根据实际数据填写。";
      }
    const responses = submittedAnswers(questions).map((response, index) => ({
      ...response,
      quality: index === 0 ? ("review" as const) : ("normal" as const),
      answers: response.answers.map((answer) =>
        questions.find((q) => q.id === answer.questionId)!.type === "scale"
          ? { ...answer, value: index === 0 ? "8" : "10" }
          : answer,
      ),
    }));
    const compiled = compileSurveyReport(template, questions, responses);
    expect(compiled.issues).toEqual([]);
    const numeric = compiled.sections
      .flatMap((section) => section.blocks)
      .filter(
        (block) =>
          block.statistic === "mean" &&
          block.questionIds.every(
            (id) => questions.find((q) => q.id === id)?.type === "scale",
          ),
      );
    expect(numeric.length).toBeGreaterThan(0);
    expect(
      numeric.every((block) =>
        block.rows.every((row) => row.value === 9 && row.count === 2),
      ),
    ).toBe(true);
  });

  it("isolates editable copies and preserves the original mock publication blockers", () => {
    const first = getBuiltinSurveyTemplates("report");
    first[0]!.questions[0]!.options[0] = "changed";
    first[0]!.template.sections[0]!.blocks[0]!.text = "changed";
    expect(first[1]!.questions[0]!.options[0]).not.toBe("changed");
    expect(
      getBuiltinSurveyTemplate(first[0]!.id, "report")!.questions[0]!
        .options[0],
    ).not.toBe("changed");
    expect(
      getBuiltinSurveyTemplate(first[0]!.id, "report")!.template.sections[0]!
        .blocks[0]!.text,
    ).not.toBe("changed");
    expect(getBuiltinSurveyTemplate(first[0]!.id, "question")).toBeUndefined();
    expect(getBuiltinSurveyTemplate("unknown", "report")).toBeUndefined();
    const mock = createSurveyWorkflowMock();
    expect(mock.questions).toEqual(
      getSurveyReferenceQuestions().map((question) => ({
        ...question,
        provenance: { source: "question-library", sourceId: question.id },
      })),
    );
    expect(mock.reportTemplate.sections).toEqual(
      getSurveyReferenceReportSections(),
    );
    expect(mock.questions.find((q) => q.id === "Q15")!.options).toEqual([]);
    expect(mock.questions.find((q) => q.id === "Q16")!.chapterId).toBe("");
    expect(getPublishBlockers(mock).map((blocker) => blocker.code)).toEqual([
      "QUESTION_OPTIONS_EMPTY",
      "MAPPING_INCOMPLETE",
    ]);
  });
});
