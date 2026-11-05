/**
 * AG06（契约束 `agent-role` R3 ⑧ / E6）—— escalate 中断的前端薄封装。
 *
 * 形状与路径全部来自 `@repo/contracts` 的 `agentRole`：载荷 `EscalatePayload`、裁决
 * `EscalateDecision`、操作 `decideEscalation`。这一层不做「谁能裁决」的判断——决策人集合
 * 只由服务端从持久化状态解析（`decide-escalation.ts`），前端只把选择原样送过去、把失败
 * 翻成人话带回来。
 */
import { translate, type MessageKey } from "./i18n/messages";
import type { Locale } from "./i18n/locale";
import { agentRole } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest } from "./api-client";
import { httpFailureText } from "./http-failure-text";

export type EscalatePayload = z.infer<typeof agentRole.EscalatePayload>;
export type EscalateDecision = z.infer<typeof agentRole.EscalateDecision>;
export type EscalationTarget = z.infer<typeof agentRole.EscalationTarget>;

/** 与 `AGENT_INTERRUPT_KIND_TO_TOOL_NAME.escalate` 同源，不手写第二份字面量。 */
export const ESCALATE_TOOL_NAME: string = agentRole.ESCALATE_TOOL_NAME;

/** 升级对象 → 成员能读懂的称呼（契约 `EscalationTarget` 闭集，漏配编译失败）。 */
const ESCALATION_TARGET_KEYS: Record<EscalationTarget, MessageKey> = {
  requester: "chatEscalation.requester", project_owner: "chatEscalation.projectOwner", org_admin: "chatEscalation.orgAdmin",
};
export function escalationTargetLabel(target: EscalationTarget, locale: Locale = "zh-CN"): string {
  return translate(locale, ESCALATION_TARGET_KEYS[target]);
}
export const ESCALATION_TARGET_LABEL: Record<EscalationTarget, string> = {
  requester: escalationTargetLabel("requester"), project_owner: escalationTargetLabel("project_owner"),
  org_admin: escalationTargetLabel("org_admin"),
};

/** `argsSummary` 是服务端写下的 `EscalatePayload` JSON；读不出就返回 null（卡片走兜底文案，绝不放行）。 */
export function parseEscalatePayload(argsSummary: string | null | undefined): EscalatePayload | null {
  if (!argsSummary) return null;
  try {
    const parsed = agentRole.EscalatePayload.safeParse(JSON.parse(argsSummary));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 契约 `decideEscalation.err` 的码 → 人话。不在表里的码按 HTTP 状态兜底，码本身从不上屏。 */
const ESCALATION_ERROR_TEXT: Partial<Record<string, MessageKey>> = {
  ESCALATION_DECIDER_FORBIDDEN: "chatEscalation.forbidden",
  INTERRUPT_KIND_MISMATCH: "chatEscalation.changed",
  AGENT_NOT_FOUND: "chatEscalation.gone",
  VALIDATION_FAILED: "chatEscalation.invalid",
  UNAUTHENTICATED: "chatEscalation.auth",
};

export function escalationFailureText(error: unknown, locale: Locale = "zh-CN"): string {
  if (error instanceof ApiError) {
    const key = error.reasonCode && Object.hasOwn(ESCALATION_ERROR_TEXT, error.reasonCode) ? ESCALATION_ERROR_TEXT[error.reasonCode] : undefined;
    return key ? translate(locale, key) : httpFailureText(error.status, locale);
  }
  return translate(locale, "chatEscalation.network");
}

export async function decideEscalation(
  interruptId: string,
  decision: EscalateDecision,
  sessionToken?: string,
): Promise<z.infer<typeof agentRole.operations.decideEscalation.out>> {
  const op = agentRole.operations.decideEscalation;
  const body = agentRole.EscalateDecision.parse(decision);
  const out = await apiRequest<unknown>(op.path.replace(":interruptId", encodeURIComponent(interruptId)), {
    method: op.method,
    body: { decision: body },
    sessionToken,
  });
  return op.out.parse(out);
}
