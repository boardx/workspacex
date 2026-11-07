import type { Locale } from "./i18n/locale";
import { translate, type MessageKey } from "./i18n/messages";
import type { InboxKind, InboxStage } from "./design-loop-label-metadata";
import { feedbackLoop, systemErrorLogs } from "@repo/contracts";

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
