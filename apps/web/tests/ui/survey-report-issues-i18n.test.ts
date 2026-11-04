import { expect, it } from "vitest";
import { survey } from "@repo/contracts";
import { surveyReportShareBlockedReason } from "@repo/contracts/survey-report";
import { translate } from "@/lib/i18n/messages";
import { displaySurveyReportIssue } from "@/lib/survey/display-report-issue";
const number: survey.SurveyWorkflowQuestion = { id: "raw-number", title: "原数值题 {count}", type: "number", chapterId: "raw-chapter", order: 1, required: false, options: [] };
const open: survey.SurveyWorkflowQuestion = { ...number, id: "raw-open", title: "原开放题 {name}", type: "open" };
function compile(patch: Partial<survey.SurveyReportBlock>, questions: survey.SurveyWorkflowQuestion[] = [], responses: survey.SurveyResponse[] = []) {
  const block: survey.SurveyReportBlock = { id: "raw-block", title: "原内容块 {count}", type: "table", questionIds: [], statistic: "mean", samplePolicy: "valid", minGroupSize: 7, ...patch };
  const template: survey.SurveyReportTemplate = { id: "raw-template", title: "原报告 {name}", sections: [{ id: "raw-section", title: "原章节 {count}", blocks: [block] }] };
  const parsed = survey.SurveyReportTemplateSchema.safeParse(template); expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Expected a structurally valid report template fixture");
  return survey.compileSurveyReport(parsed.data, questions, responses);
}
const cases: [string, Partial<survey.SurveyReportBlock>, survey.SurveyWorkflowQuestion[], string, string][] = [
  ["empty text", { type: "text", text: "" }, [], "文本内容为空", "The text content is empty."],
  ["missing image", { type: "image" }, [], "尚未配置图片 URL", "No image URL configured."],
  ["unbound", {}, [], "尚未选择题目", "No questions selected."],
  ["missing reference", { questionIds: ["raw-missing"] }, [], "引用的题目不存在，请重新绑定", "A referenced question no longer exists. Bind it again."],
  ["gap target", { type: "gap", questionIds: [number.id] }, [number], "缺少目标基准，无法计算差距", "No target baseline is set, so the gap cannot be calculated."],
  ["sample absence", { questionIds: [number.id] }, [number], "没有可用样本", "No usable samples."],
  ["unsupported statistic", { questionIds: [open.id] }, [open], "原开放题 {name}：此题型不支持均值", "原开放题 {name}: This question type does not support means."],
  ["raw title and no answers", { questionIds: [number.id] }, [number], "原数值题 {count}：没有合法作答样本", "原数值题 {count}: No valid answer samples."],
];
it.each(cases)("renders the actual %s compiler diagnostic without changing the report or data", (_name, patch, questions, source, english) => {
  const report = compile(patch, questions), before = structuredClone(report), issues = report.sections[0]!.blocks[0]!.issues; expect(issues).toContain(source);
  expect(displaySurveyReportIssue(source, (key, params) => translate("en", key, params))).toBe(english);
  expect(displaySurveyReportIssue(source, (key, params) => translate("zh-CN", key, params))).toBe(source); expect(report).toEqual(before);
});
it("retains the actual privacy group-size warning and hidden rows while translating only its display", () => {
  const group: survey.SurveyWorkflowQuestion = { ...number, id: "raw-group", title: "原分组 {name}", order: 2, type: "single", options: ["原甲", "原乙"], config: { optionIds: ["a", "b"] } };
  const responses: survey.SurveyResponse[] = [2, 3].map((value, index) => ({ id: `raw-response-${index}`, role: "原角色", companySize: "原规模", quality: "normal", analysis: "included", submittedAt: "2026-11-04T06:00:00.000Z", durationSeconds: 20, answers: [{ questionId: number.id, value: String(value) }, { questionId: group.id, value: "a" }] }));
  const report = compile({ questionIds: [number.id], groupByQuestionId: group.id }, [number, group], responses), before = structuredClone(report), block = report.sections[0]!.blocks[0]!;
  expect(block.warnings).toContain("分组有效样本不足 7，已隐藏"); expect(block.rows).toEqual([]);
  expect(displaySurveyReportIssue("分组有效样本不足 7，已隐藏", (key, params) => translate("en", key, params))).toBe("Groups with fewer than 7 valid samples are hidden."); expect(report).toEqual(before);
});
it.each([
  [undefined, [], "报告缺少纳入分析样本口径，请重新生成后再导出或共享", "The report has no included-sample basis. Regenerate it before exporting or sharing."],
  [{ total: 3, pendingReview: 0, excluded: 0, included: 3 }, [], "纳入分析的样本不足 5 份，无法导出或共享报告", "Fewer than 5 responses are included. The report cannot be exported or shared."],
  [{ total: 8, pendingReview: 0, excluded: 0, included: 8 }, [{ id: "raw-section", title: "原章节", blocks: [{ id: "raw-block", title: "原内容块 {count}", type: "table", questionIds: [], statistic: "mean", samplePolicy: "valid", minGroupSize: 5, rows: [{ label: "原指标", value: 2, count: 1 }], issues: [] }] }], "“原内容块 {count}”的输出样本不足 5 份，无法导出或共享报告", "The output sample for “原内容块 {count}” has fewer than 5 responses. The report cannot be exported or shared."],
] as [survey.CompiledSurveyReport["sampleSummary"], survey.CompiledSurveyReport["sections"], string, string][])("keeps the original report sharing gate while translating its actual reason", (sampleSummary, sections, source, english) => {
  const report = { sampleSummary, sections }, before = structuredClone(report); expect(surveyReportShareBlockedReason(report)).toBe(source);
  expect(displaySurveyReportIssue(source, (key, params) => translate("en", key, params))).toBe(english); expect(surveyReportShareBlockedReason(report)).toBe(source); expect(report).toEqual(before);
});
it.each(["constructor", "__proto__", "原模型说明 {count}"])("keeps an unknown/model diagnostic literal: %s", source => {
  expect(displaySurveyReportIssue(source, (key, params) => translate("en", key, params))).toBe(source);
});
