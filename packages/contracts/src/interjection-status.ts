import { z } from "zod";
/**
 * 一条插话对用户可见的去向。**四种，互斥，都是终局或在途，没有第五种「悬着」。**
 *
 * ⚠ issue #3405（#3399 的治因项）—— `not_applied` 曾经是「run 进终态时还没应用」的
 * 唯一去向，而全仓没有任何一处把那句话带进下一轮：助手从头到尾没收到它。
 * 现在这个枚举把两件**本质不同**的事分开：
 *
 * · `carried_over` —— 本轮没来得及应用，但服务端已经把它作为下一条人类消息投进同一
 *   线程，它真的进了下一轮的模型输入。这是 composer 那句「agent 会在下一步前纳入」
 *   的落地形态。
 * · `not_applied` —— 真的没有下一轮（用户主动取消了本轮；或本轮**自己**就是上一次
 *   带入产生的、已到深度上限）。终局，靠用户手动「重新发送」。
 *
 * 「哪一条走哪一支」的唯一事实源是数据库触发器
 * `workbench_journal_unapplied_interjections`（migration 20260911060000）里的那个
 * `CASE`，不在这里、也不在前端再写第二份判定。
 */
export const InterjectionStatus = z.enum(["received","applied","carried_over","not_applied"]);
export const PublicInterjection = z.object({
  interjectionId: z.string(), text: z.string(), status: InterjectionStatus,
  receivedAt: z.string(), appliedAt: z.string().nullable(),
  /** `carried_over` 时指向真正执行这句话的那一轮 run；其余状态恒为 `null`。 */
  carriedOverRunId: z.string().nullable().default(null),
}).strict();
export type PublicInterjection = z.infer<typeof PublicInterjection>;
export const operations={list:{method:"GET",path:"/agent-runs/:runId/interjections",out:z.object({items:z.array(PublicInterjection)}).strict()}};
