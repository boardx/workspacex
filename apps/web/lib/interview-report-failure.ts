/** Controlled public reason codes only; provider exception text is never shown. */
export function interviewReportFailureMessage(reason: string | null | undefined): string {
  if (reason === "REPORT_ACTION_VALIDATION_REJECTED") return "行动建议未通过校验，请重试。";
  if (reason === "REPORT_QUALITY_REJECTED") return "报告分析未通过校验，请重试。";
  if (reason === "REPORT_GROUNDING_REJECTED") return "报告引用未通过校验，请重试。";
  return "报告生成未完成，请重试。";
}
