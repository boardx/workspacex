import { INBOX_KIND_LABEL, INBOX_STAGE_LABEL } from "@/lib/design-loop-label-metadata";
import { systemErrorLogs } from "@repo/contracts";

/** Display projection only. Canonical values and state machines remain in contracts. */
export const designLoopCommonZhCN = {
  "designLoop.stage.backlog": INBOX_STAGE_LABEL.backlog,
  "designLoop.stage.doing": INBOX_STAGE_LABEL.doing,
  "designLoop.stage.done": INBOX_STAGE_LABEL.done,
  "designLoop.stage.archived": INBOX_STAGE_LABEL.archived,
  "designLoop.kind.feedback": INBOX_KIND_LABEL.feedback,
  "designLoop.kind.exception": INBOX_KIND_LABEL.exception,
  "designLoop.kind.design": INBOX_KIND_LABEL.design,
  "designLoop.status.development": systemErrorLogs.SystemErrorStatus.enum.已转入开发,
  "designLoop.github.open": "Open",
  "designLoop.github.draft": "Draft",
  "designLoop.github.merged": "Merged",
  "designLoop.github.closed": "Closed",
} as const;
export const designLoopCommonEn: Record<keyof typeof designLoopCommonZhCN, string> = {
  "designLoop.stage.backlog": "Pending",
  "designLoop.stage.doing": "In progress",
  "designLoop.stage.done": "Completed",
  "designLoop.stage.archived": "Won’t do",
  "designLoop.kind.feedback": "Feedback (requests / bugs)",
  "designLoop.kind.exception": "System errors",
  "designLoop.kind.design": "Design",
  "designLoop.status.development": "Sent to development",
  "designLoop.github.open": "Open",
  "designLoop.github.draft": "Draft",
  "designLoop.github.merged": "Merged",
  "designLoop.github.closed": "Closed",
};
