/**
 * AI 主动发言的判定 —— **唯一一处计算**（chat 束 domain.md I-19，uc-8-2 UC-10 / 规则 1 / AC4 / E1d）。
 *
 * ## 核心不变量：取不到来源是「正常返回但不发言」，不是错误
 *
 * 契约 `agentProactiveSpeak` 的注释逐字：「做成 `throw NO_SOURCE` 会让上游 catch 住之后
 * 『兜底发一条』——那正是要防的」。所以这里的返回类型是一个判别联合，`no-source` 分支
 * 与「关闭」分支都不是异常，调用方（application 层）也不应该把它们转成 HTTP 错误——
 * `err` 只有 `CONTEXT_API_UNAVAILABLE`（取来源这个动作本身失败），与「取到了但没有
 * 来源」是两件事，不能合并成一个错误码。
 *
 * ## 判定顺序：先看开关，再看来源——不是反过来
 *
 * `agentOptedIn === false` 时**不去问有没有来源**：单个 agent 关闭主动插话后，
 * 「这次刚好有来源」不构成发言理由（A5：关闭后只在被 `@` 时发言）。反过来做——
 * 先查来源，再查开关——在测试里看不出区别（两者都导向不发言），但会诱使未来的
 * 实现在「关着但有来源」分支里悄悄发一条「毕竟有来源就发了吧」，那正是规则 1
 * 要防的噪音源头。所以这里把开关判在最前面，且用**提前 return**表达，不给后面的
 * 分支留下「其实也可以发」的空子。
 *
 * ⚠ 契约 `reason` 是单值字面量 `"no-source"`（`emitted: false` 时非空，取值目前只有
 *   这一个），没有第二个枚举成员表达「因为开关关着」。这是一个已知的契约表达力缺口
 *   （不是本函数造的）：`agentOptedIn === false` 与「取到了开关但没有来源」在对外
 *   响应体里目前**无法区分**。本函数如实按契约现状返回 `"no-source"`，不擅自在契约
 *   之外发明第二个 reason 字面量（那会是本文件自己声明了一份契约没有的取值）。
 */
import type { z } from "zod";
import { chat as C } from "@repo/contracts";

export type ProactiveSpeakResult = z.infer<typeof C.operations.agentProactiveSpeak.out>;

export interface ProactiveSpeechDecisionInput {
  /** 该 agent 的主动插话开关。默认行为是开（规则 1），调用方须显式传入当前值。 */
  readonly agentOptedIn: boolean;
  /** 是否取到了来源。**不是「来源是否非空字符串」，是「Context API 有没有给出一条可用证据」**。 */
  readonly hasSource: boolean;
}

export interface ProactiveSpeechDecision {
  readonly emitted: boolean;
  readonly reason: "no-source" | null;
}

/**
 * 纯判定：给定「开关」与「有没有来源」两个事实，回答「发不发」。
 *
 * ⚠ 本函数**不生成 `messageId`**——那是一个真实的写操作（新建一条消息），
 *   属于 application 层的职责（且消息创建端口本身是已登记的契约缺口，见
 *   `application/chat/get-thread.ts` 文件头「citations 写死为 []」旁边那条注记）。
 *   本函数只回答「emitted」与「reason」，`messageId` 留给调用方在真正写入后填入。
 */
export function decideProactiveSpeech(
  input: ProactiveSpeechDecisionInput,
): ProactiveSpeechDecision {
  // A5：关闭主动插话后，同场景下只在被 @ 时发言——这里不判断是不是被 @ 触发，
  // 那是调用方的职责（`trigger` 字段区分场景），本函数只处理「主动」这一支。
  if (!input.agentOptedIn) return { emitted: false, reason: "no-source" };
  if (!input.hasSource) return { emitted: false, reason: "no-source" };
  return { emitted: true, reason: null };
}
