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
});
