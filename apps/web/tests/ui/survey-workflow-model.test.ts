import { describe, expect, it } from "vitest";
import { survey } from "@repo/contracts";
import {
  createSurveyWorkflowMock,
  getPublishBlockers,
  getSurveyMetrics,
  markResponseForReview,
} from "@/lib/survey/workflow-model";

describe("survey workflow model", () => {
  it("从同一答卷集合派生总数、有效样本与需复核数", () => {
    const model = createSurveyWorkflowMock();
    const metrics = getSurveyMetrics(model);

    expect(metrics.received).toBe(model.responses.length);
    expect(metrics.valid).toBe(model.responses.filter((item) => item.quality === "normal").length);
    expect(metrics.needsReview).toBe(model.responses.filter((item) => item.quality === "review").length);
    expect(metrics.completionRate).toBe(Math.round((model.responses.length / model.publication.target) * 100));
  });

  it("一次返回全部发布阻断", () => {
    const model = createSurveyWorkflowMock();
    expect(getPublishBlockers(model).map((item) => item.code)).toEqual([
      "QUESTION_OPTIONS_EMPTY",
      "MAPPING_INCOMPLETE",
    ]);
  });

  it("标记复核后派生计数同步变化", () => {
    const before = createSurveyWorkflowMock();
    const after = markResponseForReview(before, "R-0007");
    expect(getSurveyMetrics(after).needsReview).toBe(getSurveyMetrics(before).needsReview + 1);
  });

  it("图表章节声明具体图表类型并拒绝未签核类型", () => {
    const model = createSurveyWorkflowMock();
    expect(model.reportTemplate.sections.find((section) => section.id === "gap")?.chartType).toBe("gap-matrix");
    expect(survey.SurveyChartTypeSchema.safeParse("radar").success).toBe(true);
    expect(survey.SurveyChartTypeSchema.safeParse("pie").success).toBe(false);
  });

  it("未知来源模块不会回退到完整示例题库", () => {
    const model = createSurveyWorkflowMock({ surveyId: "new", creationDraft: { name: "未知模块问卷", tags: [], sourceModuleId: "missing" } });

    expect(model.questions).toEqual([]);
    expect(model.survey.title).toBe("未知模块问卷");
  });

  it("现有问卷忽略来源模块并保留答卷题目契约", () => {
    const model = createSurveyWorkflowMock({ surveyId: "sv-1", creationDraft: { name: "不应使用", tags: [], sourceModuleId: "strategy" } });
    const questionIds = new Set(model.questions.map((question) => question.id));

    expect(model.questions).toHaveLength(16);
    expect(model.responses).toHaveLength(62);
    expect(model.responses.flatMap((response) => response.answers).every((answer) => questionIds.has(answer.questionId))).toBe(true);
  });

  it.each([
    ["空白新问卷", undefined],
    ["未知来源新问卷", "missing"],
  ])("%s 以零安全指标和无题阻断禁止发布", (_label, sourceModuleId) => {
    const model = createSurveyWorkflowMock({ surveyId: "new", creationDraft: { name: "安全检查", tags: [], sourceModuleId } });
    const zeroTargetModel = { ...model, publication: { ...model.publication, target: 0 } };
    const metrics = getSurveyMetrics(zeroTargetModel);

    expect(model.questions).toEqual([]);
    expect(getPublishBlockers(model).map((item) => item.code)).toContain("QUESTIONS_EMPTY");
    expect(metrics).toMatchObject({ received: 0, valid: 0, needsReview: 0, completionRate: 0, averageDurationSeconds: 0 });
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
  });

  it("使用创建草稿标题生成空白问卷", () => {
    const model = createSurveyWorkflowMock({ surveyId: "new", creationDraft: { name: "空白问卷", tags: ["内部"] } });

    expect(model.survey.title).toBe("空白问卷");
    expect(model.questions).toEqual([]);
  });

  it("使用创建草稿标题并复制唯一来源模块", () => {
    const model = createSurveyWorkflowMock({ surveyId: "new", creationDraft: { name: "战略调查", tags: [], sourceModuleId: "strategy" } });

    expect(model.survey.title).toBe("战略调查");
    expect(model.questions.map((question) => question.id)).toEqual(["Q04", "Q05", "Q06"]);
  });
});
