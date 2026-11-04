import type { SurveyWorkflowQuestion } from "@repo/contracts/survey-question-types";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
type Translator = (key: MessageKey, params?: MessageParams) => string;
/** Return-original shape only, before Task4's first semantic RED. */
export function displaySurveyAnswerMessage(_question: SurveyWorkflowQuestion, message: string, _t: Translator): string {
  return message;
}
