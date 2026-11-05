import { expect, it } from "vitest";
import { validateSurveyAnswer, type SurveyWorkflowQuestion, type SurveyAnswerValue } from "@repo/contracts/survey-question-types";
import { translate } from "@/lib/i18n/messages";
import { displaySurveyAnswerMessage } from "@/lib/survey/display-answer-message";
const q = (patch: Partial<SurveyWorkflowQuestion> = {}): SurveyWorkflowQuestion => ({ id: "raw-q", title: "原问题 {count}", type: "open", chapterId: "raw-chapter", order: 1, required: true, options: [], ...patch });
const cases: [string, SurveyWorkflowQuestion, SurveyAnswerValue | undefined, string, string][] = [
  ["required", q(), undefined, "请完成必答题", "Complete this required question."],
  ["minimum text", q({ config: { minLength: 5 } }), "原", "答案长度不足", "Answer is too short."],
  ["maximum text", q({ config: { maxLength: 2 } }), "原abc", "答案过长", "Answer is too long."],
  ["numeric", q({ type: "number" }), "bad", "答案必须是有效数字", "Answer must be a valid number."],
  ["minimum number", q({ type: "number", config: { min: 2 } }), "1", "答案低于最小值", "Answer is below the minimum."],
  ["maximum number", q({ type: "number", config: { max: 2 } }), "3", "答案高于最大值", "Answer is above the maximum."],
  ["number step", q({ type: "number", config: { min: 0, step: 2 } }), "3", "答案不符合步长", "Answer does not match the step."],
  ["NPS", q({ type: "nps" }), "11", "答案高于最大值", "Answer is above the maximum."],
  ["email", q({ type: "email" }), "raw-not-mail", "邮箱格式不正确", "Enter a valid email address."],
  ["phone", q({ type: "phone" }), "123", "手机号码格式不正确", "Enter a valid phone number."],
  ["date", q({ type: "date" }), "2026-02-30", "日期无效", "Enter a valid date."],
  ["time", q({ type: "time" }), "25:00", "时间无效", "Enter a valid time."],
  ["datetime", q({ type: "datetime" }), "2026-02-30T25:00", "日期时间无效", "Enter a valid date and time."],
  ["matrix raw row", q({ type: "matrix_input", config: { rows: [{ id: "done", label: "原已填", required: true }, { id: "missing", label: "原行 {count}", required: true }] } }), { done: "原值" }, "原行 {count}尚未填写", "原行 {count} is required."],
  ["authored default-looking label", q({ type: "multiple_text", config: { fields: [{ id: "raw", label: "答案", required: true }, { id: "done", label: "原字段", required: true }] } }), { done: "原值" }, "答案尚未填写", "答案 is required."],
  ["prototype-looking label", q({ type: "multiple_text", config: { fields: [{ id: "raw", label: "constructor {name}", required: true }, { id: "done", label: "原字段", required: true }] } }), { done: "原值" }, "constructor {name}尚未填写", "constructor {name} is required."],
  ["exclusive", q({ type: "multi", options: ["原甲", "原乙"], config: { optionIds: ["a", "b"], exclusiveOptionIds: ["a"] } }), ["a", "b"], "互斥选项不能与其他选项同时选择", "An exclusive option cannot be selected with other options."],
  ["selection count", q({ type: "multi", options: ["原甲", "原乙"], config: { optionIds: ["a", "b"], minSelections: 2 } }), ["a"], "选择数量不符合限制", "The number of selections is outside the allowed range."],
  ["ranking", q({ type: "ranking", options: ["原甲", "原乙"], config: { optionIds: ["a", "b"] } }), ["a"], "排序须包含每个选项且仅一次", "Rank every option exactly once."],
  ["cascade", q({ type: "cascade", config: { cascadePaths: [["原省", "原市"]] } }), ["原省"], "请选择完整有效的级联路径", "Choose a complete valid cascading path."],
  ["allocation total", q({ type: "allocation", options: ["原甲", "原乙"], config: { optionIds: ["a", "b"], total: 100 } }), { a: "20", b: "30" }, "分配合计必须为 100", "The allocation total must be 100."],
  ["file count", q({ type: "file", config: { maxFiles: 1 } }), ["raw-a", "raw-b"], "附件数量超出限制", "Too many attachments."],
  ["other", q({ type: "single", options: ["原甲"], config: { optionIds: ["a"], other: true } }), { selected: "__other__", other: "" }, "请填写其他说明", "Enter details for Other."],
];
it.each(cases)("translates the actual %s validation result while preserving canonical diagnostics and raw authored data", (_name, question, answer, source, en) => {
  const before = structuredClone({ question, answer }); const errors = validateSurveyAnswer(question, answer); expect(errors).toContain(source);
  expect(displaySurveyAnswerMessage(question, source, (key, params) => translate("en", key, params))).toBe(en);
  expect(displaySurveyAnswerMessage(question, source, (key, params) => translate("zh-CN", key, params))).toBe(source);
  expect(validateSurveyAnswer(question, answer)).toEqual(errors); expect({ question, answer }).toEqual(before);
});
it.each(["constructor", "__proto__", "原未知诊断 {count}"])("keeps an unknown diagnostic literal: %s", message => {
  expect(displaySurveyAnswerMessage(q(), message, (key, params) => translate("en", key, params))).toBe(message);
});
