import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { subtaskRun as C } from "@repo/contracts";

export type SubtaskRunStatus = C.SubtaskRunStatus;
export type SubtaskRunView = C.SubtaskRun;

const SUBTASK_STATUS_KEYS: Record<SubtaskRunStatus, MessageKey> = {
  pending: "chatRuns.pending", running: "chatRuns.running", completed: "chatRuns.completed",
  failed: "chatRuns.failed", cancelled: "chatRuns.cancelled",
};
export function subtaskRunStatusLabel(status: SubtaskRunStatus, locale: Locale = "zh-CN"): string {
  return translate(locale, SUBTASK_STATUS_KEYS[status]);
}
export const SUBTASK_RUN_STATUS_LABEL: Record<SubtaskRunStatus, string> = {
  pending: subtaskRunStatusLabel("pending"), running: subtaskRunStatusLabel("running"),
  completed: subtaskRunStatusLabel("completed"), failed: subtaskRunStatusLabel("failed"),
  cancelled: subtaskRunStatusLabel("cancelled"),
};

export const SUBTASK_RUN_STATUS_TONE: Record<
  SubtaskRunStatus,
  "primary" | "ai" | "danger" | "neutral"
> = {
  pending: "neutral",
  running: "ai",
  completed: "primary",
  failed: "danger",
  cancelled: "neutral",
};

export function isSubtaskRunActive(run: SubtaskRunView): boolean {
  return run.status === "pending" || run.status === "running";
}
