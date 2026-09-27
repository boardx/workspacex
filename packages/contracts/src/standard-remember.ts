/**
 * issue #4344 —— `wx_remember`：agent 的**唯一**记忆工具。它不写记忆，只替用户在**这一轮**的回答下方
 * 打开 F17 那张「记住」确认卡（与用户说「记住：…」时同一张卡、同一个 `kg_open_memory_card`）。
 * 用户点「记住」之后才进知识图谱（会话里一条 + 个人空间一条，面板可见、可撤销）；点「不用了」什么都不写。
 *
 * 模型只给「要记的那句话」。**会话、消息、请求人一律取自服务端的 run**（`agent_runs.thread_id /
 * input_message_id`、触发消息的作者），工具参数里没有、也不接受任何 id —— `.strict()` 让多带一个
 * `threadId` / `sourceMessageId` 的调用直接 400，而不是被悄悄忽略。
 *
 * 退役：`wx_memory_search / write / delete`（LangMem + 独立的 `workspacex_memory` 库）不再挂给 agent；
 * 代码与数据保留（见 `standard-memory.ts`），只是不在原生准入表里了。
 */
import { z } from "zod";
import { NativeSessionResolveInput } from "./native-session-binding";

export const STANDARD_REMEMBER_TOOL = "wx_remember" as const;
/** 与 `KgMemoryCard.items[].statement`、`kg_open_memory_card` 的上限同一个数。 */
export const REMEMBER_STATEMENT_MAX = 2000;

export const RememberInput = z.object({
  statement: z.string().min(2).max(REMEMBER_STATEMENT_MAX).regex(/\S/),
}).strict();

/**
 * 开不了卡的具体原因（不合成一句「不可用」）：
 * - `not_personal_thread`：长期记忆只在本人的个人对话里记（F17 / F11 同一条边界），项目对话里不开卡；
 * - `not_thread_owner`：这一轮不是对话创建者本人发起的（F17 E1）；
 * - `statement_rejected`：数据库不接受这句话（空白 / 超长）。
 */
export const RememberRefusalCode = z.enum(["not_personal_thread", "not_thread_owner", "statement_rejected"]);
export type RememberRefusalCode = z.infer<typeof RememberRefusalCode>;

export const RememberOutput = z.discriminatedUnion("outcome", [
  /** 新开了一张卡：还没有记，等用户确认。 */
  z.object({ outcome: z.literal("card_opened"), cardId: z.string().min(1), statement: z.string(), saved: z.literal(false), instruction: z.string() }).strict(),
  /** 这一轮已经有一张卡（用户自己说了「记住：…」，或本轮已经调过一次）：一轮只出一张，没有再开。 */
  z.object({ outcome: z.literal("card_already_open"), cardId: z.string().min(1), saved: z.literal(false), instruction: z.string() }).strict(),
  z.object({ outcome: z.literal("refused"), code: RememberRefusalCode, saved: z.literal(false), instruction: z.string() }).strict(),
]);
export type RememberOutput = z.infer<typeof RememberOutput>;

const identity = NativeSessionResolveInput.omit({ runId: true }).extend({
  toolCallId: z.string().min(1).max(256),
  permissionRequestId: z.string().uuid().optional(),
});
export const StandardRememberInvocation = identity.extend({
  toolName: z.literal(STANDARD_REMEMBER_TOOL),
  toolArgs: RememberInput,
}).strict();
export type StandardRememberInvocation = z.infer<typeof StandardRememberInvocation>;

/**
 * 网关没接下这次调用时，Python 侧交还模型的错误码（HTTP 状态 → 码，一一对应，不合成一句「不可用」）：
 * 400 → `remember_invalid_request`（参数不合契约，例如多带了 id）；401 / 403 → `remember_not_authorized`
 * （run 已结束 / 租约丢失 / 不是本人可见的会话）；其余（503、超时、响应不合契约）→ `remember_unavailable`。
 * 三种都**没有**开卡、什么都没记。开卡按 run 幂等（`kg_memory_cards` 的 `UNIQUE (org_id, run_id)`），重调不会出第二张。
 */
export const RememberFailureCode = z.enum(["remember_invalid_request", "remember_not_authorized", "remember_unavailable"]);

export const STANDARD_REMEMBER_LIMITS = { deadlineMs: 10000, maxResponseBytes: 65536 } as const;
