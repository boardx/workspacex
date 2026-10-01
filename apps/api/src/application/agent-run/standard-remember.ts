/**
 * issue #4344 —— `wx_remember`：agent 的记忆工具 = 在这一轮的回答下方打开 F17 的「记住」确认卡。
 *
 * **只开卡，不写记忆**（I-15 / I-17）：卡是 open 的，用户点「记住」才经 `kg_act_on_memory_card` 以本人身份写进
 * 会话与个人空间（面板可见、可撤销）；点「不用了」什么都不写。与用户自己说「记住：…」是同一张卡、同一个开卡函数，
 * 区别只在卡上的字是谁提的（`origin = agent_tool`，见迁移 20260927300000）。
 *
 * **会话、消息、请求人全部来自服务端的 run**：接口层（`PgStandardRemember`）按 runId 读出 `agent_runs.thread_id /
 * input_message_id` 与触发消息的作者，过一遍 run 授权与会话可见性，再调这里；模型只给那句话，契约不接受任何 id。
 *
 * 结果是给模型的结构化事实（`RememberOutput`）：开了 / 本轮已有卡 / 为什么没开（具体原因码）。每一种都带 `saved: false`
 * 与一句该怎么对用户说的指引——这件工具的全部意义就是让模型别再说「已经记住了」。
 */
import type { RememberOutput, StandardRememberInvocation } from "@repo/contracts/standard-remember";
import type { OrgId } from "../../domain/org-id";
import { newKgId } from "../knowledge-graph/ids";
import type { MemoryCardPort } from "../knowledge-graph/ports";

export const STANDARD_REMEMBER = Symbol("StandardRemember");

/**
 * 系统提示里关于记忆的那段（只在原生执行档、且本轮挂了工具时拼进去——只有那里有 `wx_remember`）。
 * 2026-09-27 devapp：用户问「为什么你没有记忆下来我的目标？」，模型去调旧工具、失败、再把同一句话说了两遍。
 * 这里把「记忆 = 回答下方那张要用户点的卡」说清楚，并且禁止在用户点之前声称已经记住。
 */
export const REMEMBER_TOOL_GUIDANCE = [
  "## 记忆",
  "用户让你记住某件事（例如「记住…」「帮我记一下…」「以后都…」「为什么你没记住我的目标」）时，调用 `wx_remember`，"
    + "把要记的内容写成一句完整、独立、第三人称也读得懂的话（例如「用户的目标是今年跑完半马」），只写这一句，不要附带解释。",
  "`wx_remember` 不会直接记下任何东西：它只在这条回答下方放一张确认卡，用户点「记住」之后才进长期记忆，点「不用了」就什么都不记。",
  "所以在用户点卡片确认之前，**不要说「已经记住了 / 已保存」**；照工具返回的 instruction 告诉用户去卡片上确认。"
    + "工具返回 refused 时，按它给的原因如实说明这次没有记下。",
  "上下文里已经有【记忆卡片】说明（用户这句话本身就开了卡）时，不要再调用 `wx_remember`。",
].join("\n");

/** 接口层的唯一入口：runId 来自 URL，其余身份事实由实现从 run 读出，不信调用方。 */
export interface StandardRemember {
  invoke(runId: string, input: StandardRememberInvocation): Promise<RememberOutput>;
}

/** run 已结束 / 租约丢失 / 请求人不再能看到这个会话：没有开卡。接口层回 403。 */
export class RememberNotAuthorizedError extends Error {
  constructor(readonly reason: string) {
    super(`remember_not_authorized:${reason}`);
    this.name = "RememberNotAuthorizedError";
  }
}

const OPENED = "确认卡已经放在这条回答下方。现在还没有记——用户点「记住」之后才会记到长期记忆（可以在卡上改字，也可以撤销）。"
  + "请告诉用户点卡片确认；不要说「已经记住了」。";
const ALREADY_OPEN = "这一轮的回答下方已经有一张记忆确认卡（一轮只出一张），这次没有再开。现在还没有记——请提醒用户在那张卡上确认；不要说「已经记住了」。";
const REFUSED: Record<Extract<RememberOutput, { outcome: "refused" }>["code"], string> = {
  not_personal_thread: "长期记忆只能在用户自己的个人对话里记，这是项目对话，所以没有开卡、什么都没记。请如实告诉用户：到自己的个人对话里说一次，就可以记下来。",
  not_thread_owner: "只有这个对话的创建者本人能让你记东西，这一轮不是他本人发起的，所以没有开卡、什么都没记。请如实告诉用户这次没有记下。",
  statement_rejected: "这句话没法作为一条记忆（空白或太长），没有开卡、什么都没记。可以换一句更短、更具体的话再调用一次。",
};

export async function openRememberCard(
  cards: MemoryCardPort,
  input: {
    readonly orgId: OrgId; readonly userId: string; readonly threadId: string;
    readonly runId: string; readonly messageId: string; readonly statement: string;
  },
): Promise<RememberOutput> {
  const statement = input.statement.trim();
  const r = await cards.open(input.orgId, {
    cardId: newKgId("card"), threadId: input.threadId, runId: input.runId, messageId: input.messageId,
    requesterUserId: input.userId, kind: "remember", origin: "agent_tool", statement,
  });
  switch (r.outcome) {
    case "opened":
      if (r.cardId === null) throw new Error("kg_open_memory_card reported opened without a card id");
      return r.reused
        ? { outcome: "card_already_open", cardId: r.cardId, saved: false, instruction: ALREADY_OPEN }
        : { outcome: "card_opened", cardId: r.cardId, statement, saved: false, instruction: OPENED };
    case "not_personal":
      return { outcome: "refused", code: "not_personal_thread", saved: false, instruction: REFUSED.not_personal_thread };
    case "not_owner":
      return { outcome: "refused", code: "not_thread_owner", saved: false, instruction: REFUSED.not_thread_owner };
    case "no_items":
    case "not_from_message":
      // agent 入口不做「出自本条消息」核对（迁移 20260927300000），not_from_message 在这里只可能是空白的字。
      return { outcome: "refused", code: "statement_rejected", saved: false, instruction: REFUSED.statement_rejected };
  }
}
