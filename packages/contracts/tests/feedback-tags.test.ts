import { describe, expect, it } from "vitest";
import { operations } from "../src/feedback-loop";
import { FeedbackTags, feedbackGithubLabels } from "../src/feedback-tags";
describe("feedback classification tags", () => {
  it("normalizes whitespace and case, and accepts legacy input", () => {
    expect(FeedbackTags.parse([" Mobile ", "mobile", "体验"])).toEqual(["Mobile", "体验"]);
    expect(operations.createFeedbackDraft.in.parse({kind:"需求", target:{kind:"product"}, detail:"", occurredRoute:null, appVersion:null})).not.toHaveProperty("tags");
  });
  it("keeps system labels and isolates workflow namespaces", () => {
    expect(FeedbackTags.safeParse(["review:code-ok"]).success).toBe(false);
    expect(feedbackGithubLabels("缺陷", ["BUG", "界面", "status:merged"], ["界面", "体验", "agent:dev"]))
      .toEqual(["user-feedback", "BUG", "界面", "体验"]);
  });
});
