/**
 * AI 按表预约的草稿侧 —— 洋葱最内层（F99，uc-6-7 R3 步骤 5-6 / D-28）。
 *
 * ## 这个文件唯一要证明的事
 *
 * 「AI 只生成草稿，人接受后才外发」不是一条接口层的 if 语句,而是一个结构性
 * 保证:草稿的文案生成是一个**纯函数**,它的类型签名里根本没有出现任何
 * 「外发」的能力(没有网络、没有 gateway、没有 send)。`draftBookingInvite`
 * (应用层)组合的依赖也不含 `OutboundGateway`——不是「有能力但选择不调用」,
 * 是「这一条调用链上不存在外发这个动作可以被调用的位置」。
 *
 * `canSendBookingInvite` 是唯一允许外发的判定,且判定的输入只有 `actorKind`:
 * D-28 说外发邮件恒 R3、R2/R3 必须人接受——这里把「必须人接受」翻译成
 * 「主体不是人类就拒绝」,不看任何其它上下文,因为再多的上下文也不能让一次
 * agent 发起的外发变得可以接受。
 */

/** 谁在触发这个动作。`"agent"` 涵盖一切非人类主体(工具调用、自动化任务等)。 */
export type BookingActorKind = "human" | "agent";

/**
 * D-28 的唯一实现:只有人类主体可以把草稿变成外发动作。
 *
 * ⚠ 不接受「agent 但已被人预先批准」这类旁路——预先批准是另一个动作
 * (`acceptCandidate`/签核之类),批准之后走的仍然是这个判定,而不是绕过它。
 */
export function canSendBookingInvite(actorKind: BookingActorKind): boolean {
  return actorKind === "human";
}

export interface DraftInviteTextInput {
  readonly roleTitle: string;
  readonly backgroundAndQuestions: string;
  readonly slots: readonly string[];
}

/**
 * 生成预约话术草稿的文案(R3 步骤 5:「AI 可以做的是生成预约话术草稿、排出建议时间」)。
 *
 * 纯函数,不做任何 I/O。刻意朴素——大纲/话术的"生成质量"是 UC-6.2 的关注点,
 * 本文件只需要证明"draft 阶段产出的是草稿文本,而不是一次外发调用"。
 */
export function draftInviteText(input: DraftInviteTextInput): string {
  const slotsLine = input.slots.length > 0 ? input.slots.join(" / ") : "（建议时间待补充）";
  const background = input.backgroundAndQuestions.trim().length > 0
    ? input.backgroundAndQuestions.trim()
    : "（背景与要问什么待补充）";
  return [
    `您好，关于「${input.roleTitle}」的访谈邀请（草稿，尚未发出）：`,
    background,
    `建议时间：${slotsLine}`,
    "本邮件为 AI 生成的草稿，需人工确认后才会发送。",
  ].join("\n");
}
