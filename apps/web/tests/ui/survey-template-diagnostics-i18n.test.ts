import { expect, it } from "vitest";
import { SURVEY_TEMPLATE_REQUEST_MAX_BYTES, SurveyTemplateInputSchema } from "@repo/contracts/survey-template-library";
import { translate } from "@/lib/i18n/messages";
import { displaySurveyTemplateMessage } from "@/lib/survey/display-template-message";
it("displays the actual bounded-request schema diagnostic without changing its byte policy", () => {
  const parsed = SurveyTemplateInputSchema.safeParse({ extra: "原".repeat(SURVEY_TEMPLATE_REQUEST_MAX_BYTES) }); expect(parsed.success).toBe(false); if (parsed.success) throw new Error("Expected the original byte-limit rejection"); const diagnostic = parsed.error.issues.find(issue => issue.code === "custom" && issue.path.length === 0)?.message; expect(diagnostic).toBe(`模板请求总大小不能超过 ${SURVEY_TEMPLATE_REQUEST_MAX_BYTES / 1024}KB（UTF-8，包含题目、报告内容及保存版本）`);
  expect(displaySurveyTemplateMessage(diagnostic!, (key, params) => translate("en", key, params))).toBe(`The template request must not exceed ${SURVEY_TEMPLATE_REQUEST_MAX_BYTES / 1024} KB (UTF-8, including questions, report content, and save version).`);
});
it.each(["constructor", "__proto__", "原未知错误 {count}"])("keeps unknown %s diagnostics raw", message => { expect(displaySurveyTemplateMessage(message, (key, params) => translate("en", key, params))).toBe(message); });
