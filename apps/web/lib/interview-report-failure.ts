import { interviewMarkdown } from "@repo/contracts";
const rejectionMessages: Record<interviewMarkdown.InterviewReportRejectionCode, string> = {
  REPORT_ACTION_VALIDATION_REJECTED: "行动建议未通过校验，请重试。",
  REPORT_QUALITY_REJECTED: "报告分析未通过校验，请重试。",
  REPORT_GROUNDING_REJECTED: "报告引用未通过校验，请重试。",
};
/** Controlled public reason codes only; provider exception text is never shown. */
export function interviewReportFailureMessage(reason: string | null | undefined): string {
  const parsed = interviewMarkdown.InterviewReportRejectionCode.safeParse(reason);
  return parsed.success ? rejectionMessages[parsed.data] : "报告生成未完成，请重试。";
}
