/**
 * 工作流权限授予 —— 用户可见文案单源（管理页 + 运行面板阻断横幅共用）。
 *
 * 能力分类 id（`artifact.write`…）是内置 Workflow 目录里的技术标识，这里给每一个配一句人话：
 * 它允许工作流「做什么」、不授予时「会怎样」。目录里新增分类而这里没写时走兜底文案，不白屏。
 * 错误码穷举契约闭集（`lint-user-facing-error-text`：不把内部码原样上屏）。
 */
import type { workflowCapabilityGrants } from "@repo/contracts";
import type { z } from "zod";
import { ApiError } from "@/lib/api-client";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { httpFailureText } from "@/lib/http-failure-text";

type Cap = z.infer<typeof workflowCapabilityGrants.WorkflowCapabilityGrant>["sideEffectCap"];
type ErrorCode = z.infer<typeof workflowCapabilityGrants.WorkflowCapabilityGrantError>;

/** 管理页路由（运行面板横幅链接到这里）。 */
export const WORKFLOW_GRANTS_HREF = "/org-admin/workflow-grants";

export interface CapabilityCopy {
  readonly label: string;
  /** 授予后工作流可以做什么。 */
  readonly allows: string;
}

const CAPABILITY_COPY: Record<string, { label: MessageKey; allows: MessageKey }> = {
  "artifact.write": { label: "workflowGrants.cap.artifact.write.label", allows: "workflowGrants.cap.artifact.write.allows" },
  "notify.inapp": { label: "workflowGrants.cap.notify.inapp.label", allows: "workflowGrants.cap.notify.inapp.allows" },
  "board.write": { label: "workflowGrants.cap.board.write.label", allows: "workflowGrants.cap.board.write.allows" },
  "interview.write": { label: "workflowGrants.cap.interview.write.label", allows: "workflowGrants.cap.interview.write.allows" },
  "interview.outline.write": { label: "workflowGrants.cap.interview.outline.write.label", allows: "workflowGrants.cap.interview.outline.write.allows" },
  "workflow.record.write": { label: "workflowGrants.cap.workflow.record.write.label", allows: "workflowGrants.cap.workflow.record.write.allows" },
  "mail.send": { label: "workflowGrants.cap.mail.send.label", allows: "workflowGrants.cap.mail.send.allows" },
  "knowledge.read": { label: "workflowGrants.cap.knowledge.read.label", allows: "workflowGrants.cap.knowledge.read.allows" },
  "project.read": { label: "workflowGrants.cap.project.read.label", allows: "workflowGrants.cap.project.read.allows" },
  "workflow.gate": { label: "workflowGrants.cap.workflow.gate.label", allows: "workflowGrants.cap.workflow.gate.allows" },
  "ticket.write": { label: "workflowGrants.cap.ticket.write.label", allows: "workflowGrants.cap.ticket.write.allows" },
  "tracker.write": { label: "workflowGrants.cap.tracker.write.label", allows: "workflowGrants.cap.tracker.write.allows" },
  "kb.publish": { label: "workflowGrants.cap.kb.publish.label", allows: "workflowGrants.cap.kb.publish.allows" },
  "docs.publish": { label: "workflowGrants.cap.docs.publish.label", allows: "workflowGrants.cap.docs.publish.allows" },
  "project.write": { label: "workflowGrants.cap.project.write.label", allows: "workflowGrants.cap.project.write.allows" },
  "project.member.write": { label: "workflowGrants.cap.project.member.write.label", allows: "workflowGrants.cap.project.member.write.allows" },
  "knowledge.graph.write": { label: "workflowGrants.cap.knowledge.graph.write.label", allows: "workflowGrants.cap.knowledge.graph.write.allows" },
  "team.roster.read": { label: "workflowGrants.cap.team.roster.read.label", allows: "workflowGrants.cap.team.roster.read.allows" },
};

export function capabilityCopy(category: string, locale: Locale = "zh-CN"): CapabilityCopy {
  const keys = Object.hasOwn(CAPABILITY_COPY, category) ? CAPABILITY_COPY[category]! : { label: "workflowGrants.cap.unknown.label" as const, allows: "workflowGrants.cap.unknown.allows" as const };
  return { label: translate(locale, keys.label), allows: translate(locale, keys.allows) };
}

const LEVEL_KEYS: Record<Cap, { label: MessageKey; description: MessageKey }> = {
  none: { label: "workflowGrants.level.none.label", description: "workflowGrants.level.none.description" },
  read: { label: "workflowGrants.level.read.label", description: "workflowGrants.level.read.description" },
  write: { label: "workflowGrants.level.write.label", description: "workflowGrants.level.write.description" },
  external_send: { label: "workflowGrants.level.external_send.label", description: "workflowGrants.level.external_send.description" },
};
export function capabilityLevelCopy(cap: Cap, locale: Locale = "zh-CN") {
  return { label: translate(locale, LEVEL_KEYS[cap].label), description: translate(locale, LEVEL_KEYS[cap].description) };
}
export const CAP_LEVEL: Record<Cap, { label: string; description: string }> = {
  none: capabilityLevelCopy("none"), read: capabilityLevelCopy("read"),
  write: capabilityLevelCopy("write"), external_send: capabilityLevelCopy("external_send"),
};

const ERROR_TEXT: Record<ErrorCode, MessageKey> = {
  NOT_ORG_ADMIN: "workflowGrants.error.NOT_ORG_ADMIN",
  UNKNOWN_CAPABILITY: "workflowGrants.error.UNKNOWN_CAPABILITY",
  DEPENDENCY_UNAVAILABLE: "workflowGrants.error.DEPENDENCY_UNAVAILABLE",
};

export function describeWorkflowGrantFailure(err: unknown, locale: Locale = "zh-CN"): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && Object.hasOwn(ERROR_TEXT, code)) return translate(locale, ERROR_TEXT[code as ErrorCode]);
    return httpFailureText(err.status, locale);
  }
  if (err instanceof TypeError) return translate(locale, "workflowGrants.error.network");
  return translate(locale, "workflowGrants.error.unknown");
}

const TARGET_SYSTEM_TEXT: Record<string, MessageKey> = {
  smtp: "workflowGrants.target.email",
  inapp: "workflowGrants.target.notification",
  files: "workflowGrants.target.files",
  board: "workflowGrants.target.board",
  workflow: "workflowGrants.target.workflow",
  artifact: "workflowGrants.target.files",
  notify: "workflowGrants.target.notification",
  mail: "workflowGrants.target.email",
};

/** 副作用目标系统的人话名；不认识时给兜底，原始值只进「技术详情」。 */
export function targetSystemText(target: string, locale: Locale = "zh-CN"): string {
  return translate(locale, Object.hasOwn(TARGET_SYSTEM_TEXT, target) ? TARGET_SYSTEM_TEXT[target]! : "workflowGrants.target.unknown");
}
