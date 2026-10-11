import { describe, expect, it } from "vitest";
import { extractReviewRewriteFeedback } from "../../src/application/research/guided-review-rewrite-feedback";
import type { QuestionEvidence } from "../../src/application/research/guided-report-evidence";
const scope: QuestionEvidence[] = [{ id: "q", questionId: "q", sectionId: "s", question: "Missing metric?", evidence: [], gap: true }];
describe("unvalidated review rewrite feedback", () => {
  it.each([undefined, null, "not JSON", { questions: [{ questionId: "unknown", status: "missing", rationale: "Invented scope." }] }, { questions: [{ questionId: "q", status: 42, rationale: "Wrong type." }] }, { questions: [{ questionId: "q", status: "missing", rationale: null }] }])("does not infer defects from invalid structure %j", raw => {
    expect(extractReviewRewriteFeedback(raw, scope)).toBeUndefined();
  });
  it("bounds and explicitly marks incomplete rationale without altering the raw verdict", () => {
    const raw = { supported: false, questions: [{ questionId: "q", status: "missing", rationale: "Missing metric needs owner verification. ".repeat(200) }] };
    const before = JSON.stringify(raw); const feedback = extractReviewRewriteFeedback(raw, scope)!;
    expect(feedback.feedbackKind).toBe("unvalidated_review_output"); expect(feedback).not.toHaveProperty("passed");
    expect(feedback.unvalidatedReviewFeedback.questions[0]).toMatchObject({ status: "missing", rationaleTruncated: true });
    expect(feedback.unvalidatedReviewFeedback.questions[0]!.rationale).toHaveLength(1000);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it("rejects ambiguous duplicated question observations", () => {
    const row = { questionId: "q", status: "missing", rationale: "Missing." };
    expect(extractReviewRewriteFeedback({ questions: [row, row] }, scope)).toBeUndefined();
  });
  it("keeps explicit unsupported claims even when no missing-question verdict is supplied", () => {
    const f = extractReviewRewriteFeedback({ supported: false, questions: [] }, scope)!;
    expect(f.unvalidatedReviewFeedback.questions).toEqual([]);
    expect(f.unvalidatedReviewFeedback.supported).toBe(false);
    expect(f.issues[0]).toContain("Remove unsupported affirmative claims");
  });
  it("never interprets malformed positive review as approval or a fabricated defect", () => {
    expect(extractReviewRewriteFeedback({ supported: true, analysisDepth: "adequate", issues: [], questions: [{ questionId: "q", status: "answered", rationale: "Claimed answer." }] }, scope)).toBeUndefined();
  });
});
