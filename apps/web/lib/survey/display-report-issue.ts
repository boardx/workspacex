import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
type Translator = (key: MessageKey, params?: MessageParams) => string;
/** Shape-only until actual compiler-diagnostic semantic RED is observed. */
export function displaySurveyReportIssue(message: string, _t: Translator): string {
  return message;
}
