import type { survey } from "@repo/contracts";
import { SURVEY_REPORT_SHARE_MIN_SAMPLE } from "@repo/contracts/survey-report";
import { surveyChoices } from "@repo/contracts/survey-question-types";
import { CLIENT_ERROR_REPORT_MAX_PER_WINDOW, CLIENT_ERROR_REPORT_WINDOW_MS } from "../../../api/src/domain/system/rate-limit";

// The real survey submission guard injects the default InMemoryRateLimiter,
// which consumes these constants. No second rate-policy declaration here.
// The UI upload-session creation and UI response consume two earlier hits.
export const firstSupplementalBatchSize = CLIENT_ERROR_REPORT_MAX_PER_WINDOW - 2;
export const supplementalWindowPauseMs = CLIENT_ERROR_REPORT_WINDOW_MS + 100;
export type BrowserSurveyAnswer = survey.SurveyResponse["answers"][number];

/** Test-only answer fixture; canonical question IDs and all other values stay raw. */
export function balancedMeetingSupplementalAnswers(
  questions: survey.SurveyWorkflowQuestion[],
  firstAnswers: BrowserSurveyAnswer[],
): BrowserSurveyAnswer[][] {
  const duration = questions.find(question => question.type === "single" && question.title === "会议时长是否合适？");
  if (!duration || surveyChoices(duration).length !== 4)
    throw Error("Expected the original four-option meeting duration question");
  const fileIds = new Set(questions.filter(question => question.type === "file").map(question => question.id));
  const base = firstAnswers.filter(answer => !fileIds.has(answer.questionId));
  // Initial reproduction of the old driver: enough total responses only.
  return Array.from({ length: SURVEY_REPORT_SHARE_MIN_SAMPLE - 1 }, () => structuredClone(base));
}
