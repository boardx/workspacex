/**
 * AG06（契约束 `agent-role` R3 ⑧ / E6）—— escalate 中断的前端薄封装。
 *
 * 形状与路径全部来自 `@repo/contracts` 的 `agentRole`：载荷 `EscalatePayload`、裁决
 * `EscalateDecision`、操作 `decideEscalation`。这一层不做「谁能裁决」的判断——决策人集合
 * 只由服务端从持久化状态解析（`decide-escalation.ts`），前端只把选择原样送过去、把失败
 * 翻成人话带回来。
 */
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
export const ESCALATION_TARGET_LABEL: Record<EscalationTarget, string> = {
  requester: "任务发起人",
  project_owner: "项目负责人",
  org_admin: "组织管理员",
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
const ESCALATION_ERROR_TEXT: Partial<Record<string, string>> = {
  ESCALATION_DECIDER_FORBIDDEN: "这件事升级给了其他人，你没有权限替他做决定",
  INTERRUPT_KIND_MISMATCH: "这条请求已经变了，刷新后再看一眼",
  AGENT_NOT_FOUND: "这条升级请求已经不在了，可能已被他人处理",
  VALIDATION_FAILED: "提交的内容不完整，请检查后再试",
  UNAUTHENTICATED: "登录状态过期了，刷新页面重新登录",
};

export function escalationFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    return (error.reasonCode && ESCALATION_ERROR_TEXT[error.reasonCode]) || httpFailureText(error.status);
  }
  return "网络连接出了问题，稍后再试一次";
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
