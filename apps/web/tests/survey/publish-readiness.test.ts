import { describe, expect, it } from "vitest";
import { assessPublishReadiness } from "@/lib/survey/publish-readiness";

describe("assessPublishReadiness", () => {
  it("turns the real publish blockers into an explainable assessment", () => {
    const assessment = assessPublishReadiness({
      questions: [
        { id: "q1", title: "你是否同意我们的优秀服务显然值得推荐？", type: "single", chapterId: "general", order: 1, required: true, options: [] },
      ],
      blockers: [
        { code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "q1", missingFields: ["options"] },
        { code: "LEADING_QUESTION", side: "question", subjectId: "q1", missingFields: ["title"] },
        { code: "MAPPING_INCOMPLETE", side: "question", subjectId: "q1", missingFields: ["reportBlock"] },
      ],
    });

    expect(assessment.qualityScore).toBe(35);
    expect(assessment.estimatedSeconds).toBe(20);
    expect(assessment.predictedCompletionRate).toBe(55);
    expect(assessment.recommendations).toEqual([
      expect.objectContaining({ subjectId: "q1", code: "QUESTION_OPTIONS_EMPTY" }),
      expect.objectContaining({ subjectId: "q1", code: "LEADING_QUESTION" }),
      expect.objectContaining({ subjectId: "q1", code: "MAPPING_INCOMPLETE" }),
    ]);
  });

  it("reports an honest unknown completion forecast without answerable questions", () => {
    const assessment = assessPublishReadiness({ questions: [], blockers: [] });
    expect(assessment.qualityScore).toBeNull();
    expect(assessment.estimatedSeconds).toBeNull();
    expect(assessment.predictedCompletionRate).toBeNull();
    expect(assessment.recommendations).toEqual([]);
  });
});
