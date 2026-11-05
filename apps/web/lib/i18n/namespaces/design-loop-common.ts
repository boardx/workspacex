import type { Locale } from "../locale";
import { translate, type MessageKey } from "../messages";
import { INBOX_KIND_LABEL, INBOX_STAGE_LABEL, type InboxKind, type InboxStage } from "@/lib/live-inbox";
import { feedbackLoop, systemErrorLogs } from "@repo/contracts";

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
export function inboxStageLabel(stage: InboxStage, locale: Locale = "zh-CN"): string {
  return translate(locale, `designLoop.stage.${stage}`);
}
export function inboxKindLabel(kind: InboxKind, locale: Locale = "zh-CN"): string {
  return translate(locale, `designLoop.kind.${kind}`);
}
const FEEDBACK_KIND_KEYS: Record<feedbackLoop.FeedbackKind, MessageKey> = {
  [feedbackLoop.FeedbackKind.enum.缺陷]: "feedbackOverlay.kind.bug",
  [feedbackLoop.FeedbackKind.enum.需求]: "feedbackOverlay.kind.request",
};
export function feedbackKindLabel(kind: feedbackLoop.FeedbackKind, locale: Locale = "zh-CN"): string {
  return translate(locale, FEEDBACK_KIND_KEYS[kind]);
}
const SOURCE_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  [feedbackLoop.FeedbackStatus.enum.待处理]: "feedbackOverlay.status.pending",
  [feedbackLoop.FeedbackStatus.enum.已进入迭代]: "feedbackOverlay.status.iteration",
  [feedbackLoop.FeedbackStatus.enum.已修复]: "feedbackOverlay.status.fixed",
  [feedbackLoop.FeedbackStatus.enum.不做]: "feedbackOverlay.status.declined",
  [feedbackLoop.FeedbackStatus.enum.已归档]: "feedbackOverlay.status.archived",
  [systemErrorLogs.SystemErrorStatus.enum.已转入开发]: "designLoop.status.development",
};
/** Legacy / future source statuses remain verbatim rather than being misclassified. */
export function inboxSourceStatusLabel(value: string, locale: Locale = "zh-CN"): string {
  const key = Object.hasOwn(SOURCE_STATUS_KEYS, value) ? SOURCE_STATUS_KEYS[value] : undefined;
  return key === undefined ? value : translate(locale, key);
}

/** Async notices retain facts and project language only when rendered. */
export interface InboxMessage { readonly render: (locale: Locale) => string }
