import { describe, expect, it } from "vitest";
import { evaluateSurveyForPublish } from "../../src/domain/survey/publish-gate";

const question = (input: {
  id: string;
  title: string;
  type: "single" | "open";
  options?: string[];
}) => ({
  id: input.id,
  order: 1,
  chapterId: "chapter-1",
  title: input.title,
  type: input.type,
  required: true,
  options: input.options ?? [],
});

describe("survey publish gate", () => {
  it("returns every blocker in stable code and subject order", () => {
    const blockers = evaluateSurveyForPublish({
      questions: [
        question({
          id: "q-optionless",
          title: "选择一个答案",
          type: "single",
        }),
        question({
          id: "q-unmapped",
          title: "请说明原因",
          type: "open",
        }),
        question({
          id: "q-leading",
          title: "你是否同意优秀的协作工具显然能提升效率？",
          type: "single",
          options: ["同意", "不同意"],
        }),
      ],
      template: {
        id: "report-1",
        title: "报告",
        sections: [
          {
            id: "section-mapped",
            title: "有效章节",
            blocks: [
              {
                id: "block-1",
                title: "结果",
                type: "metric",
                questionIds: ["q-optionless", "q-leading"],
                statistic: "count",
                samplePolicy: "valid",
                minGroupSize: 5,
              },
            ],
          },
          { id: "section-empty", title: "空章节", blocks: [] },
        ],
      },
    });

    expect(
      blockers.map(({ code, side, subjectId }) => ({ code, side, subjectId })),
    ).toEqual([
      {
        code: "LEADING_QUESTION",
        side: "question",
        subjectId: "q-leading",
      },
      {
        code: "MAPPING_INCOMPLETE",
        side: "question",
        subjectId: "q-unmapped",
      },
      {
        code: "MAPPING_INCOMPLETE",
        side: "section",
        subjectId: "section-empty",
      },
      {
        code: "QUESTION_OPTIONS_EMPTY",
        side: "question",
        subjectId: "q-optionless",
      },
    ]);
  });

  it("reports an empty survey as one survey-level blocker", () => {
    expect(
      evaluateSurveyForPublish({
        questions: [],
        template: { id: "report-1", title: "报告", sections: [] },
      }),
    ).toEqual([
      {
        code: "QUESTIONS_EMPTY",
        side: "survey",
        subjectId: "survey",
        missingFields: ["questions"],
      },
    ]);
  });

  it("reports a broken conditional rule against the question that needs repair", () => {
    const blockers = evaluateSurveyForPublish({
      questions: [
        question({ id: "q-1", title: "是否继续", type: "single", options: ["是", "否"] }),
        {
          ...question({ id: "q-2", title: "补充原因", type: "open" }),
          config: {
            visibleWhen: [
              { questionId: "missing", operator: "equals", value: "是" },
            ],
          },
        },
      ],
      template: {
        id: "report-1",
        title: "报告",
        sections: [
          {
            id: "section-1",
            title: "结果",
            blocks: [
              {
                id: "block-1",
                title: "回答",
                type: "table",
                questionIds: ["q-1", "q-2"],
                statistic: "responses",
                samplePolicy: "valid",
                minGroupSize: 5,
              },
            ],
          },
        ],
      },
    });

    expect(blockers).toContainEqual({
      code: "LOGIC_INVALID",
      side: "question",
      subjectId: "q-2",
      missingFields: ["显示条件只能引用前面有效的题目"],
    });
  });

  it("rejects a report section whose blocks do not consume any survey question", () => {
    const blockers = evaluateSurveyForPublish({
      questions: [
        question({ id: "q-1", title: "请说明原因", type: "open" }),
      ],
      template: {
        id: "report-1",
        title: "报告",
        sections: [
          {
            id: "section-decorative-only",
            title: "无有效供料",
            blocks: [
              {
                id: "block-text",
                title: "说明",
                type: "text",
                questionIds: [],
                statistic: "responses",
                samplePolicy: "valid",
                minGroupSize: 5,
              },
            ],
          },
        ],
      },
    });

    expect(blockers).toEqual([
      {
        code: "MAPPING_INCOMPLETE",
        side: "question",
        subjectId: "q-1",
        missingFields: ["reportBlock"],
      },
      {
        code: "MAPPING_INCOMPLETE",
        side: "section",
        subjectId: "section-decorative-only",
        missingFields: ["blocks"],
      },
    ]);
  });

  it("ignores page elements when checking answer-question mappings", () => {
    const blockers = evaluateSurveyForPublish({
      questions: [
        {
          ...question({ id: "intro", title: "欢迎填写", type: "open" }),
          type: "description" as const,
          required: false,
        },
        question({ id: "q-1", title: "请说明原因", type: "open" }),
      ],
      template: {
        id: "report-1",
        title: "报告",
        sections: [
          {
            id: "section-1",
            title: "结果",
            blocks: [
              {
                id: "block-1",
                title: "回答",
                type: "table",
                questionIds: ["q-1"],
                statistic: "responses",
                samplePolicy: "valid",
                minGroupSize: 5,
              },
            ],
          },
        ],
      },
    });

    expect(blockers).toEqual([]);
  });

  it("does not treat decorative block references as report data supply", () => {
    const blockers = evaluateSurveyForPublish({
      questions: [question({ id: "q-1", title: "请说明原因", type: "open" })],
      template: {
        id: "report-1",
        title: "报告",
        sections: [
          {
            id: "section-decorative-only",
            title: "说明",
            blocks: [
              {
                id: "block-text",
                title: "说明",
                type: "text",
                questionIds: ["q-1"],
                statistic: "responses",
                text: "静态说明",
                samplePolicy: "valid",
                minGroupSize: 5,
              },
            ],
          },
        ],
      },
    });

    expect(blockers.map(({ side, subjectId }) => ({ side, subjectId }))).toEqual([
      { side: "question", subjectId: "q-1" },
      { side: "section", subjectId: "section-decorative-only" },
    ]);
  });
});
