import { describe, expect, it } from "vitest";
import {
  SURVEY_QUESTION_TYPES,
  createSurveyQuestion,
  validateSurveyQuestion,
  validateSurveyAnswer,
  validateSurveyQuestions,
  visibleSurveyQuestions,
  formatSurveyAnswer,
  surveyChoices,
  SurveyAnswerValueSchema,
} from "../src/survey-question-types";
import {
  compileSurveyReport,
  SurveyReportTemplateSchema,
} from "../src/survey-report";
import type {
  SurveyAnswerValue,
  SurveyWorkflowQuestion,
} from "../src/survey-question-types";
const q = (type: SurveyWorkflowQuestion["type"]) =>
  createSurveyQuestion(type, type, 1);
describe("shared question registry and validation", () => {
  it("has 29 forms and two page elements; image choices explicitly need author-supplied images", () => {
    expect(SURVEY_QUESTION_TYPES).toHaveLength(31);
    for (const entry of SURVEY_QUESTION_TYPES) {
      const errors = validateSurveyQuestion(q(entry.type));
      if (entry.type === "image_single" || entry.type === "image_multi")
        expect(errors.join(" ")).toContain("图片和替代文字");
      else expect(errors, entry.type).toEqual([]);
    }
  });
  it("accepts one legitimate answer for every answer form", () => {
    for (const entry of SURVEY_QUESTION_TYPES) {
      const question = q(entry.type),
        choices = surveyChoices(question),
        c = question.config ?? {};
      let value: SurveyAnswerValue | undefined;
      switch (question.type) {
        case "description":
        case "page_break":
          value = undefined;
          break;
        case "single":
        case "dropdown":
        case "image_single":
        case "scale":
          value = choices[0]!.id;
          break;
        case "multi":
        case "image_multi":
          value = [choices[0]!.id];
          break;
        case "number":
        case "rating":
        case "nps":
        case "slider":
          value = "3";
          break;
        case "date":
          value = "2026-09-21";
          break;
        case "time":
          value = "13:30";
          break;
        case "datetime":
          value = "2026-09-21T13:30";
          break;
        case "email":
          value = "sample@example.com";
          break;
        case "phone":
          value = "+8613812345678";
          break;
        case "multiple_text":
        case "address":
          value = Object.fromEntries(
            c.fields!.map((field) => [field.id, "已填写"]),
          );
          break;
        case "matrix_single":
        case "matrix_scale":
        case "matrix_dropdown":
          value = Object.fromEntries(
            c.rows!.map((row) => [row.id, choices[0]!.id]),
          );
          break;
        case "matrix_multi":
          value = Object.fromEntries(
            c.rows!.map((row) => [row.id, [choices[0]!.id]]),
          );
          break;
        case "matrix_input":
          value = Object.fromEntries(
            c.rows!.map((row) => [row.id, "逐项说明"]),
          );
          break;
        case "allocation":
          value = Object.fromEntries(
            choices.map((choice) => [choice.id, "50"]),
          );
          break;
        case "ranking":
          value = choices.map((choice) => choice.id);
          break;
        case "cascade":
          value = c.cascadePaths![0]!;
          break;
        case "file":
        case "signature":
          value = ["asset-1"];
          break;
        default:
          value = "实际回答";
      }
      expect(validateSurveyAnswer(question, value), question.type).toEqual([]);
    }
  });
  it("rejects unknown blank record fields even on optional questions", () => {
    expect(
      validateSurveyAnswer(
        { ...q("multiple_text"), required: false },
        { forged: "" },
      ),
    ).not.toEqual([]);
    expect(validateSurveyAnswer(q("page_break"), {})).not.toEqual([]);
  });
  it("blocks incomplete image choices, unsafe URLs and missing alt text", () => {
    const question = q("image_single"),
      choices = surveyChoices(question);
    question.config = {
      ...question.config,
      images: Object.fromEntries(
        choices.map((choice) => [
          choice.id,
          { url: "https://example.com/image.png", alt: choice.label },
        ]),
      ),
    };
    expect(validateSurveyQuestion(question)).toEqual([]);
    question.config.images![choices[0]!.id]!.alt = "";
    expect(validateSurveyQuestion(question)).not.toEqual([]);
    question.config.images![choices[0]!.id] = {
      url: "javascript:alert(1)",
      alt: "说明",
    };
    expect(validateSurveyQuestion(question)).not.toEqual([]);
  });
  it("accepts typed row records but never an arbitrary nested JSON answer", () => {
    expect(SurveyAnswerValueSchema.safeParse({ r: ["a", "b"] }).success).toBe(
      true,
    );
    expect(
      SurveyAnswerValueSchema.safeParse({ r: { nested: true } }).success,
    ).toBe(false);
  });
  it("validates IDs, legacy labels, other text and exclusive selections", () => {
    const question = q("multi"),
      choices = surveyChoices(question);
    question.config = {
      ...question.config,
      other: true,
      exclusiveOptionIds: [choices[0]!.id],
    };
    expect(validateSurveyAnswer(question, [choices[1]!.id])).toEqual([]);
    expect(validateSurveyAnswer(question, [choices[1]!.label])).toEqual([]);
    expect(
      validateSurveyAnswer(question, [choices[0]!.id, choices[1]!.id]).length,
    ).toBeGreaterThan(0);
    expect(
      validateSurveyAnswer(question, [choices[1]!.id, choices[1]!.id]).length,
    ).toBeGreaterThan(0);
    expect(
      validateSurveyAnswer(question, {
        selected: ["__other__"],
        other: "说明",
      }),
    ).toEqual([]);
    expect(
      validateSurveyAnswer(question, { selected: ["__other__"], other: "" })
        .length,
    ).toBeGreaterThan(0);
    expect(validateSurveyAnswer(question, ["forged"]).length).toBeGreaterThan(
      0,
    );
  });
  it("does not coerce blank numeric values to zero or accept out-of-range scores", () => {
    expect(validateSurveyAnswer(q("number"), "")).not.toEqual([]);
    expect(validateSurveyAnswer(q("nps"), "11")).not.toEqual([]);
    expect(validateSurveyAnswer(q("nps"), "9")).toEqual([]);
    expect(validateSurveyAnswer(q("number"), "Infinity")).not.toEqual([]);
    expect(
      validateSurveyAnswer(
        { ...q("slider"), config: { min: 0, max: 10, step: 2 } },
        "3",
      ),
    ).not.toEqual([]);
  });
  it("validates semantic dates, formats, field identities and matrix rows", () => {
    expect(validateSurveyAnswer(q("date"), "2026-02-30")).not.toEqual([]);
    expect(validateSurveyAnswer(q("date"), "2024-02-29")).toEqual([]);
    expect(validateSurveyAnswer(q("email"), "not-an-email")).not.toEqual([]);
    expect(validateSurveyAnswer(q("time"), "25:00")).not.toEqual([]);
    const matrix = q("matrix_single");
    const answer = Object.fromEntries(
      matrix.config!.rows!.map((row) => [row.id, surveyChoices(matrix)[0]!.id]),
    );
    expect(validateSurveyAnswer(matrix, answer)).toEqual([]);
    expect(
      validateSurveyAnswer(matrix, { ...answer, forged: "a" }),
    ).not.toEqual([]);
    expect(
      validateSurveyAnswer(q("multiple_text"), { forged: "secret" }),
    ).not.toEqual([]);
  });
  it("rejects invalid ranking, allocation, cascade and attachment identities", () => {
    const rank = q("ranking"),
      choices = surveyChoices(rank).map((c) => c.id);
    expect(validateSurveyAnswer(rank, choices)).toEqual([]);
    expect(validateSurveyAnswer(rank, [choices[0]!, choices[0]!])).not.toEqual(
      [],
    );
    const allocation = q("allocation"),
      ids = surveyChoices(allocation).map((c) => c.id);
    expect(
      validateSurveyAnswer(allocation, { [ids[0]!]: "40", [ids[1]!]: "60" }),
    ).toEqual([]);
    expect(
      validateSurveyAnswer(allocation, { [ids[0]!]: "40", [ids[1]!]: "50" }),
    ).not.toEqual([]);
    const cascade = q("cascade");
    expect(
      validateSurveyAnswer(cascade, cascade.config!.cascadePaths![0]!),
    ).toEqual([]);
    expect(validateSurveyAnswer(cascade, ["invalid"])).not.toEqual([]);
    expect(
      validateSurveyAnswer(q("file"), ["https://evil.test/file"]),
    ).not.toEqual([]);
    expect(validateSurveyAnswer(q("signature"), ["asset-1"])).toEqual([]);
  });
  it("ignores stale answers from hidden questions and validates forward-only dependencies", () => {
    const first = q("single");
    const second = {
      ...q("short"),
      order: 2,
      config: {
        visibleWhen: [
          {
            questionId: first.id,
            operator: "equals" as const,
            value: surveyChoices(first)[0]!.id,
          },
        ],
      },
    };
    const third = {
      ...q("open"),
      order: 3,
      config: {
        visibleWhen: [
          {
            questionId: second.id,
            operator: "equals" as const,
            value: "stale",
          },
        ],
      },
    };
    expect(
      visibleSurveyQuestions([first, second, third], {
        [first.id]: surveyChoices(first)[1]!.id,
        [second.id]: "stale",
      }).map((item) => item.id),
    ).toEqual([first.id]);
    expect(validateSurveyQuestions([first, second, third])).toEqual([]);
    expect(validateSurveyQuestions([second, first])).not.toEqual([]);
    expect(validateSurveyAnswer(q("description"), "fake")).not.toEqual([]);
  });
  it("formats stable IDs and structured values with human labels", () => {
    const question = q("matrix_single");
    const row = question.config!.rows![0]!;
    const choice = surveyChoices(question)[0]!;
    expect(formatSurveyAnswer(question, { [row.id]: choice.id })).toContain(
      `${row.label}：${choice.label}`,
    );
  });
});
function compiled(
  question: SurveyWorkflowQuestion,
  statistic: string,
  values: SurveyAnswerValue[],
) {
  const template = SurveyReportTemplateSchema.parse({
    id: "r",
    title: "r",
    sections: [
      {
        id: "s",
        title: "s",
        blocks: [
          {
            id: "b",
            title: "b",
            type: "table",
            questionIds: [question.id],
            statistic,
          },
        ],
      },
    ],
  });
  return compileSurveyReport(
    template,
    [question],
    values.map((value, i) => ({
      id: String(i),
      role: "user",
      companySize: "1",
      quality: "normal" as const,
      submittedAt: "2026-09-21T00:00:00.000Z",
      durationSeconds: 10,
      answers: [{ questionId: question.id, value }],
    })),
  ).sections[0]!.blocks[0]!;
}
describe("new question statistics", () => {
  it("excludes stale hidden answers from statistical samples", () => {
    const gate = q("single"),
      measured = {
        ...q("number"),
        order: 2,
        config: {
          visibleWhen: [
            {
              questionId: gate.id,
              operator: "equals" as const,
              value: surveyChoices(gate)[0]!.id,
            },
          ],
        },
      };
    const template = SurveyReportTemplateSchema.parse({
      id: "r",
      title: "r",
      sections: [
        {
          id: "s",
          title: "s",
          blocks: [
            {
              id: "b",
              title: "b",
              type: "metric",
              questionIds: [measured.id],
              statistic: "mean",
            },
          ],
        },
      ],
    });
    const samples = [0, 1].map((i) => ({
      id: String(i),
      role: "user",
      companySize: "1",
      quality: "normal" as const,
      submittedAt: "2026-09-21T00:00:00.000Z",
      durationSeconds: 1,
      answers: [
        { questionId: gate.id, value: surveyChoices(gate)[i]!.id },
        { questionId: measured.id, value: i ? "99" : "2" },
      ],
    }));
    expect(
      compileSurveyReport(template, [gate, measured], samples).sections[0]!
        .blocks[0]!.rows,
    ).toEqual([{ label: "数字", value: 2, count: 1 }]);
  });
  it("uses answered respondents as the denominator of multi-choice percentages", () => {
    const question = q("multi"),
      [a, b] = surveyChoices(question).map((c) => c.id);
    expect(
      compiled(question, "percentage", [[a!, b!], [b!], []]).rows.map((row) => [
        row.value,
        row.count,
      ]),
    ).toEqual([
      [50, 1],
      [100, 2],
    ]);
  });
  it("preserves text as text and reports attachment counts without keys or URLs", () => {
    expect(compiled(q("open"), "responses", ["原始回答"]).answerTexts).toEqual([
      { label: "多行文本", value: "原始回答" },
    ]);
    expect(
      compiled(q("file"), "responses", [["asset-secret"]]).answerTexts,
    ).toEqual([{ label: "文件上传", value: "附件 1 个" }]);
  });
  it("computes NPS from promoters minus detractors and excludes missing answers", () => {
    const result = compiled(q("nps"), "nps", ["10", "9", "7", "0", ""]);
    expect(result.rows[0]).toMatchObject({ value: 25, count: 4 });
  });
  it("aggregates ranking by option and supports first-choice percentage", () => {
    const question = q("ranking"),
      [a, b] = surveyChoices(question).map((c) => c.id);
    expect(
      compiled(question, "mean_rank", [
        [a!, b!],
        [b!, a!],
      ]).rows.map((row) => row.value),
    ).toEqual([1.5, 1.5]);
    expect(
      compiled(question, "first_choice", [
        [a!, b!],
        [a!, b!],
      ]).rows.map((row) => row.value),
    ).toEqual([100, 0]);
  });
  it("computes each matrix row separately, without zero-filling missing optional cells", () => {
    const question = q("matrix_scale");
    question.required = false;
    const [a, b] = question.config!.rows!;
    const choices = surveyChoices(question);
    const result = compiled(question, "mean", [
      { [a!.id]: choices[0]!.id, [b!.id]: choices[2]!.id },
      { [a!.id]: choices[2]!.id },
    ]);
    expect(result.rows.map((row) => [row.value, row.count])).toEqual([
      [2, 2],
      [3, 1],
    ]);
  });
  it("aggregates allocation per option and never treats text or files as numeric", () => {
    const question = q("allocation"),
      [a, b] = surveyChoices(question).map((c) => c.id);
    expect(
      compiled(question, "mean", [
        { [a!]: "20", [b!]: "80" },
        { [a!]: "40", [b!]: "60" },
      ]).rows.map((row) => row.value),
    ).toEqual([30, 70]);
    for (const type of ["short", "date", "file"] as const)
      expect(compiled(q(type), "mean", ["1"]).rows).toEqual([]);
  });
});

it.each(["multi", "image_multi", "matrix_multi"] as const)(
  "rejects zero maximum selections for %s",
  (type) => {
    const question = q(type);
    question.config = { ...question.config, maxSelections: 0 };
    expect(validateSurveyQuestion(question).length).toBeGreaterThan(0);
  },
);
it("rejects an empty file format allowlist", () => {
  const question = q("file");
  question.config = { ...question.config, allowedExtensions: [] };
  expect(validateSurveyQuestion(question).length).toBeGreaterThan(0);
});
