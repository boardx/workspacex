import { expect, it } from "vitest";
import type { survey } from "@repo/contracts";
import { compileSurveyReport, SURVEY_REPORT_SHARE_MIN_SAMPLE, surveyReportShareBlockedReason } from "@repo/contracts/survey-report";
import { createSurveyQuestion, surveyChoices, validateSurveyAnswer } from "@repo/contracts/survey-question-types";
import { getBuiltinSurveyTemplates } from "@/lib/survey/builtin-templates";
import { balancedMeetingSupplementalAnswers, firstSupplementalBatchSize, supplementalWindowPauseMs } from "../../e2e/support/survey-balanced-report-samples";
import { CLIENT_ERROR_REPORT_MAX_PER_WINDOW, CLIENT_ERROR_REPORT_WINDOW_MS } from "../../../api/src/domain/system/rate-limit";

function fixture() {
  const source = structuredClone(getBuiltinSurveyTemplates("question").find(item => item.title === "会议反馈调查")!);
  expect(source).toBeTruthy();
  source.questions[0]!.title = "原会议名称 {count}";
  const file = createSurveyQuestion("file", "browser-file", 9);
  file.title = "原文件问题 {name}"; file.required = false;
  source.questions.push(file);
  // Same real-editor binding as the browser driver; original report stays intact.
  source.template.sections[0]!.blocks[0]!.questionIds.push(file.id);
  const answers: survey.SurveyResponse["answers"] = source.questions.map(question => ({ questionId: question.id, value:
    question.type === "short" ? "原会议回答 {count}" :
    question.type === "date" ? "2026-11-04" :
    question.type === "scale" ? surveyChoices(question)[3]!.id :
    question.type === "single" ? surveyChoices(question)[1]!.id :
    question.type === "file" ? ["browser-attachment"] : "原建议 {name}\nKeep the original answer." }));
  const response = (value: typeof answers, index: number): survey.SurveyResponse => ({ id: `browser-response-${index}`, quality: "normal", analysis: "included", role: "原角色", companySize: "原范围", submittedAt: "2026-11-04T06:00:00.000Z", durationSeconds: 120, answers: structuredClone(value) });
  const compile = (values: typeof answers[]) => compileSurveyReport(source.template, source.questions, values.map(response));
  return { source, answers, compile };
}
it("reproduces the old driver's privacy failure even after its total sample threshold", () => {
  const { answers, compile } = fixture();
  const report = compile(Array.from({ length: SURVEY_REPORT_SHARE_MIN_SAMPLE }, () => answers));
  expect(report.sampleSummary?.included).toBe(SURVEY_REPORT_SHARE_MIN_SAMPLE);
  expect(report.sections.flatMap(section => section.blocks).flatMap(block => block.rows).some(row => row.count === 0)).toBe(true);
  expect(surveyReportShareBlockedReason(report)).toContain("输出样本不足");
});
it("keeps the original one-response report blocked", () => {
  const { answers, compile } = fixture();
  expect(surveyReportShareBlockedReason(compile([answers]))).toContain("无法导出或共享报告");
});
it("covers every unchanged report output group with real-submit-valid balanced answers", () => {
  const { source, answers, compile } = fixture(), before = structuredClone({ source, answers });
  const supplemental = balancedMeetingSupplementalAnswers(source.questions, answers);
  const expectedTotal = 4 * SURVEY_REPORT_SHARE_MIN_SAMPLE;
  expect(supplemental).toHaveLength(expectedTotal - 1);
  const all = [answers, ...supplemental], duration = source.questions.find(question => question.type === "single")!;
  for (const choice of surveyChoices(duration))
    expect(all.filter(row => row.find(answer => answer.questionId === duration.id)?.value === choice.id)).toHaveLength(SURVEY_REPORT_SHARE_MIN_SAMPLE);
  for (const row of supplemental) {
    expect(row.some(answer => answer.questionId === "browser-file")).toBe(false);
    for (const answer of row) expect(validateSurveyAnswer(source.questions.find(question => question.id === answer.questionId)!, answer.value)).toEqual([]);
    expect(row.filter(answer => answer.questionId !== duration.id)).toEqual(answers.filter(answer => answer.questionId !== duration.id && answer.questionId !== "browser-file"));
  }
  const report = compile(all);
  expect(report.issues).toEqual([]);
  expect(report.sampleSummary?.included).toBe(expectedTotal);
  for (const block of report.sections.flatMap(section => section.blocks)) {
    for (const row of block.rows) expect(row.count).toBeGreaterThanOrEqual(SURVEY_REPORT_SHARE_MIN_SAMPLE);
    if (block.answerTexts?.length) expect(block.answerTexts.length).toBeGreaterThanOrEqual(SURVEY_REPORT_SHARE_MIN_SAMPLE);
  }
  expect(surveyReportShareBlockedReason(report)).toBeUndefined();
  expect({ source, answers }).toEqual(before);
});
it("uses the actual guard policy and fits at most two bounded submission windows", () => {
  const { source, answers } = fixture(), supplemental = balancedMeetingSupplementalAnswers(source.questions, answers);
  expect(firstSupplementalBatchSize + 2).toBe(CLIENT_ERROR_REPORT_MAX_PER_WINDOW);
  expect(supplementalWindowPauseMs).toBeGreaterThan(CLIENT_ERROR_REPORT_WINDOW_MS);
  expect(supplemental.length - firstSupplementalBatchSize).toBeLessThanOrEqual(CLIENT_ERROR_REPORT_MAX_PER_WINDOW);
});
