import { translate } from "@/lib/i18n/messages";
import { expect, it } from "vitest";
import { interviewCategoryText } from "@/lib/interview-category-text";
import { interviewQualityText } from "@/lib/interview-quality-text";
it.each(["constructor", "toString", "__proto__"])("preserves unknown category %s as raw data", value => {
  expect(interviewCategoryText(value, "en")).toBe(value);
  expect(interviewCategoryText(value, "zh-CN")).toBe(value);
});
it.each(["constructor", "toString", "__proto__"])("preserves unknown diagnostic code %s and its authored text", code => {
  const issue = { code, message: "原始诊断 {goal}" };
  expect(interviewQualityText(issue, "en")).toBe(issue.message);
  expect(interviewQualityText(issue, "zh-CN")).toBe(issue.message);
});

it.each([
  [
    "itv.characters",
    "1 character",
    "2 characters"
  ],
  [
    "itv.history.count",
    "1 interview",
    "2 interviews"
  ],
  [
    "itv.experts.count",
    "1 expert",
    "2 experts"
  ],
  [
    "itv.outline.generating",
    "Generating questions for 1 expert",
    "Generating questions for 2 experts"
  ],
  [
    "itv.runs.expertCount",
    "1 expert",
    "2 experts"
  ],
  [
    "itv.experts.profileCount",
    "1 simulated profile",
    "2 simulated profiles"
  ],
  [
    "itv.skill.expertCount",
    "Recommended experts \u00b7 1 expert",
    "Recommended experts \u00b7 2 experts"
  ],
  [
    "itv.legacy.questionCount",
    "1 question",
    "2 questions"
  ],
  [
    "itv.legacy.mockCount",
    "Generate exploratory answers for 1 digital expert.",
    "Generate exploratory answers for 2 digital experts."
  ],
  [
    "itv.legacy.years",
    "1 year old",
    "2 years old"
  ]
] as const)("uses natural English counts for %s", (key, one, two) => {
  expect(translate("en", key, { count: 1 })).toBe(one);
  expect(translate("en", key, { count: 2 })).toBe(two);
});

it("keeps completed-expert progress independent of the total noun form", () => {
  expect(translate("en", "itv.experts.completed", { completed: 1, total: 1 })).toBe("Experts completed: 1 / 1");
});
