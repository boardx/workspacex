/**
 * AG06 —— `escalate` 中断的 resume 载荷解析（03-agent-role.md R3 ⑧、E6）。
 *
 * `parseEscalateResumePayload`：把原始 resume JSON 解析为 decision-guard 的
 * `ParsedResumePayload`。合法 `EscalateDecision`（resolve/reject）⇒ impliedKind `escalate`；
 * 形状是其他已知 kind（例如 `choose_option` 的 `{decision:"edit",editedArgs:{selectedOptionId}}`）
 * ⇒ 返回对应 impliedKind，交给 guard 判 `INTERRUPT_KIND_MISMATCH`；都不是 ⇒ `null`
 * （`MALFORMED_RESUME_PAYLOAD`）。
 *
 * E7（超时保持 pending、永不自动批准）不在这里用函数"声明"：唯一会改 run 状态的超时路径是
 * `sweepOrphanedRuns`（只收 `running`），由 escalate-decision-guard.test.ts 在真库上断言
 * 过期的 escalate 中断仍是 `awaiting_tool_permission` 且没有任何裁决落账。
 */
import {
  ChooseOptionDecision,
  ConfirmIntentDecision,
  FillParamsDecision,
  type AgentInterruptKind,
} from "@repo/contracts/agent-interrupts";
import { EscalateDecision } from "@repo/contracts/agent-role";
import type { ParsedResumePayload } from "./decision-guard";

/**
 * ⚠ 仅供 escalate 中断使用，**不是**通用 resume 解析器：它先试 `EscalateDecision`，
 * 一个同时满足 escalate 与其他 kind schema 的载荷会被归为 escalate。对 escalate 中断这是
 * 正确偏向（本就是要判它是不是 escalate 形状）；对其他 kind 复用会误判。不要导出。
 */
function escalateFirstImpliedKind(body: unknown): AgentInterruptKind | null {
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
  const impliedKind = escalateFirstImpliedKind(body);
  if (impliedKind === null) return null;
  return { impliedKind, requestId, selectedOptionFound: null };
}
