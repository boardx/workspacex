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
