import type { MessageKey } from "@/lib/i18n/messages";
import type { DigitalInterviewHistoryRow } from "@/lib/interview-api";

export const INTERVIEW_STATUS_LABEL: Record<DigitalInterviewHistoryRow["status"], MessageKey> = {
  draft: "itv.status.draft",
  topic_pending: "itv.status.topic_pending",
  experts_pending: "itv.status.experts_pending",
  questions_pending: "itv.status.questions_pending",
  running: "itv.status.running",
  report_pending: "itv.status.report_pending",
  completed: "itv.status.completed",
  failed: "itv.status.failed",
};

export function interviewStatusMessageKey(status: string): MessageKey | null {
  if (status === "archived") return "itv.live.archived";
  return Object.prototype.hasOwnProperty.call(INTERVIEW_STATUS_LABEL, status)
    ? INTERVIEW_STATUS_LABEL[status as DigitalInterviewHistoryRow["status"]] : null;
}
