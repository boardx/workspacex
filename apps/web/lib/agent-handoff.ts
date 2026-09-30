/**
 * AG07（契约束 `agent-role` UC-7）—— 聊天 handoff 卡片的前端薄封装。
 *
 * 形状与路径全部来自 `@repo/contracts`（`listThreadHandoffs` / `confirmHandoff` / `cancelHandoff`），
 * 不手写第二份。谁能看见、能不能确认是服务端的裁决；这一层只把失败翻成人话（不上屏原始码）。
 */
import { agentRole, chat } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest } from "./api-client";

export type HandoffView = z.infer<typeof agentRole.HandoffView>;
export type HandoffEvidenceItem = z.infer<typeof agentRole.HandoffEvidenceItem>;
export type ThreadHandoffs = z.infer<typeof agentRole.operations.listThreadHandoffs.out>;
export type ConfirmHandoffResult = z.infer<typeof agentRole.operations.confirmHandoff.out>;

export const HANDOFF_SOURCE_UNAVAILABLE_COPY = agentRole.HANDOFF_SOURCE_UNAVAILABLE_COPY;

export async function listThreadHandoffs(threadId: string, sessionToken?: string): Promise<ThreadHandoffs> {
  const out = await apiRequest<unknown>(agentRole.operations.listThreadHandoffs.path, {
    method: "GET", query: { threadId }, sessionToken,
  });
  return agentRole.operations.listThreadHandoffs.out.parse(out);
}

export async function confirmHandoff(handoffId: string, sessionToken?: string): Promise<ConfirmHandoffResult> {
  const out = await apiRequest<unknown>(
    agentRole.operations.confirmHandoff.path.replace(":handoffId", encodeURIComponent(handoffId)),
    { method: "POST", sessionToken },
  );
  return agentRole.operations.confirmHandoff.out.parse(out);
}

export async function cancelHandoff(handoffId: string, sessionToken?: string): Promise<void> {
  await apiRequest<unknown>(
    agentRole.operations.cancelHandoff.path.replace(":handoffId", encodeURIComponent(handoffId)),
    { method: "POST", sessionToken },
  );
}

/** 失败 → 人话。`HANDOFF_NOT_ALLOWED` 带原因时用契约里的同一份拒绝文案。 */
export function handoffFailureText(error: unknown, targetRole: string): string {
  if (error instanceof ApiError) {
    if (error.reasonCode === "HANDOFF_NOT_ALLOWED") {
      const raw = error.raw as { reason?: unknown } | null;
      const reason = agentRole.HandoffNotAllowedReason.safeParse(raw?.reason);
      return reason.success
        ? agentRole.handoffNotAllowedCopy(reason.data, targetRole)
        : "这次转交目前不被允许。当前对话会继续；如需要，可以直接联系对应负责人。";
    }
    if (error.reasonCode === "HANDOFF_NOT_FOUND") return "这条转交已失效（可能已取消或已处理），请刷新后查看。";
  }
  return "操作没有成功，请稍后重试。";
}

/** 确认时复核失败（`rejected`）的说明：同一份契约拒绝文案。 */
export function handoffRejectedText(view: HandoffView): string {
  return view.notAllowedReason
    ? agentRole.handoffNotAllowedCopy(view.notAllowedReason, view.targetName ?? view.targetRole)
    : "未能转交。当前对话会继续；如需要，可以直接联系对应负责人。";
}

/** 卡片上的状态短语。 */
export function handoffStatusText(view: HandoffView): string {
  switch (view.status) {
    case "requested":
      return "等待你确认";
    case "confirmed":
      return "已转交";
    case "cancelled":
      return "已取消";
    case "rejected":
      return "未能转交";
  }
}

/** 交接包里的问题原文可能带着触发标记（`[request_handoff:D003]` 等）——展示前剥掉（同一份规则）。 */
export function handoffQuestionText(view: HandoffView): string {
  return chat.stripControlMarkers(view.packet.originalQuestion) || view.packet.originalQuestion;
}

/**
 * 确认转交后，接收方新线程的**首条消息草稿**（UIUX r1 屏 4 P0-3）：把交接包摘要预填进输入框，
 * 用户看一眼就能发出去。接收方不自动开跑（AG07 语义不变）——发不发由用户决定。
 */
export function handoffDraftText(view: HandoffView): string {
  const { packet } = view;
  const lines = [`我从上一个对话转交过来，请你接手：${handoffQuestionText(view)}`];
  if (packet.confirmedScope.trim() !== "") lines.push(`已确认的范围：${packet.confirmedScope.trim()}`);
  if (packet.openItems.length > 0) lines.push(`还没定的事：${packet.openItems.join("；")}`);
  if (packet.evidenceRefs.length > 0) lines.push(`相关资料 ${packet.evidenceRefs.length} 份已随转交附上（见上方转交卡片）。`);
  return lines.join("\n");
}

/**
 * `request_handoff` 工具结果 → 拒绝时的聊天提示（UIUX r1 屏 4：拒绝也要是一条友好的行内提示）。
 * 结果正文以服务端给出的中文句子开头（`outcome.message`，`deep_agent_service/tools.py`），后面跟着
 * 只给模型看的指令；已登记（等待确认）的那一支由转交卡片承载，这里返回 null。
 * 认不出的形状返回 null——不猜，不把给模型的话摆给用户。
 */
export function handoffRefusalNotice(result: string | undefined): string | null {
  if (typeof result !== "string") return null;
  const text = result.trim();
  if (text === "" || text.includes("在用户确认前不要自行继续")) return null;
  const cut = text.search(/\s*(?:不要改转给其它角色|不要重试)/u);
  if (cut <= 0) return null;
  return text.slice(0, cut).trim();
}
