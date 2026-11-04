import { interviewMarkdown } from "@repo/contracts";
import { translate, type MessageKey } from "./i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
const rejectionKeys: Record<interviewMarkdown.InterviewReportRejectionCode, MessageKey> = {
  "REPORT_ACTION_VALIDATION_REJECTED": "itv.report.failure.REPORT_ACTION_VALIDATION_REJECTED",
  "REPORT_QUALITY_REJECTED": "itv.report.failure.REPORT_QUALITY_REJECTED",
  "REPORT_GROUNDING_REJECTED": "itv.report.failure.REPORT_GROUNDING_REJECTED"
};
/** Controlled public reason codes only; provider exception text is never shown. */
export function interviewReportFailureKey(reason: string | null | undefined): MessageKey {
  const parsed = interviewMarkdown.InterviewReportRejectionCode.safeParse(reason);
  return parsed.success ? rejectionKeys[parsed.data] : "itv.report.failure.generic";
}
export function interviewReportFailureMessage(reason: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, interviewReportFailureKey(reason));
}
