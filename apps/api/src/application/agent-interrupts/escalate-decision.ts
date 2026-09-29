/**
 * AG06 —— `escalate` 中断的 resume 载荷解析与超时语义（03-agent-role.md R3 ⑧、E6、E7）。
 *
 * - `parseEscalateResumePayload`：把原始 resume JSON 解析为 decision-guard 的
 *   `ParsedResumePayload`。合法 `EscalateDecision`（resolve/reject）⇒ impliedKind `escalate`；
 *   形状是其他已知 kind（例如 `choose_option` 的 `{decision:"edit",editedArgs:{selectedOptionId}}`）
 *   ⇒ 返回对应 impliedKind，交给 guard 判 `INTERRUPT_KIND_MISMATCH`；都不是 ⇒ `null`
 *   （`MALFORMED_RESUME_PAYLOAD`）。
 * - `escalationStatusAfterTimeout`：E7——超时无人处理保持 pending，永不自动批准。
 */
import {
  ChooseOptionDecision,
  ConfirmIntentDecision,
  FillParamsDecision,
  type AgentInterruptKind,
} from "@repo/contracts/agent-interrupts";
import { EscalateDecision } from "@repo/contracts/agent-role";
import type { ParsedResumePayload } from "./decision-guard";

function impliedKindOf(body: unknown): AgentInterruptKind | null {
  if (EscalateDecision.safeParse(body).success) return "escalate";
  if (ChooseOptionDecision.safeParse(body).success) return "choose_option";
  if (FillParamsDecision.safeParse(body).success) return "fill_params";
  if (ConfirmIntentDecision.safeParse(body).success) return "confirm_intent";
  return null;
}

export function parseEscalateResumePayload(raw: string, requestId: string | null): ParsedResumePayload {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const impliedKind = impliedKindOf(body);
  if (impliedKind === null) return null;
  return { impliedKind, requestId, selectedOptionFound: null };
}

export type EscalationStatus = "pending" | "resolved" | "rejected";

/** E7：超时不改变状态——pending 保持 pending；已决的保持已决。不存在"超时自动批准"分支。 */
export function escalationStatusAfterTimeout(current: EscalationStatus): EscalationStatus {
  return current;
}
