import { describe, expect, it } from "vitest";
import { SurveyWorkflowSchema, SurveyWorkflowStepSchema } from "../src/survey";

describe("SurveyWorkflowStepSchema", () => {
  it("只接受已确认的五步工作流", () => {
    expect(SurveyWorkflowStepSchema.options).toEqual([
      "design",
      "template",
      "publish",
      "responses",
      "report",
    ]);
    expect(SurveyWorkflowStepSchema.safeParse("vote").success).toBe(false);
  });
});

describe("SurveyWorkflowSchema", () => {
  it("拒绝引用不存在题目的答卷", () => {
    const result = SurveyWorkflowSchema.safeParse({
      survey: {
        id: "sv-1",
        title: "企业数字协作成熟度诊断",
        status: "collecting",
        lastSavedAt: "2026-08-12T10:00:00.000Z",
      },
      questions: [],
      reportTemplate: { sections: [] },
      publication: { target: 100, link: "https://survey.boardx.test/s/sv-1" },
      responses: [
        {
          id: "R-0001",
          role: "部门负责人",
          companySize: "200–999人",
          quality: "normal",
          submittedAt: "2026-08-12T09:00:00.000Z",
          durationSeconds: 348,
          answers: [{ questionId: "missing", value: "企业高管" }],
        },
      ],
      report: { generatedAt: "2026-08-12T10:00:00.000Z", sections: [] },
    });

    expect(result.success).toBe(false);
  });
});
