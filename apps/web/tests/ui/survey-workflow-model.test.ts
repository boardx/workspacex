import { describe, expect, it } from "vitest";
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
});
