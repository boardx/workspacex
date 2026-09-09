import { wave2Runtime } from "@repo/contracts";
import type { z } from "zod";

export type AgentRunFailureReasonValue = z.infer<typeof wave2Runtime.AgentRunFailureReason>;

/**
 * issue #3211 ① —— 「这次 run 为什么失败」在服务端的分类器。
 *
 * ## 这不是「以前修过的那句话又坏了」，是那道门从来没修到产品面
 *
 * 人类看到的「模型这次没能返回可用结果」不是服务端下发的文案，是
 * `apps/web/lib/agent-run.ts` 把枚举码 `MODEL_CALL_FAILED` **在客户端**译出来的一句话。
 * `execute-run.ts` 的 catch 块（#3033）确实算出了带真实异常的 `detail`，但它自己的注释
 * 逐字写着：
 *
 *   > The provider's own words live here and stop here. `detail` never reaches a response;
 *   > the run's terminal `error` is the enumerated code above.
 *
 * 也就是说 `detail` 只进日志、从不上线。于是**至少三件完全不同的事**在产品里长得一模一样：
 *   ① 模型真的返回了空（`provider returned neither content nor a progress event`）；
 *   ② 远端 deep-agent run 自己报错 / 超时 / HTTP 失败（`deep-agent-model-provider.ts` 里
 *      二十来处不同的 `ModelCallError` detail）；
 *   ③ **我们自己的执行器抛异常**（`execute-run.ts` 末尾的 "agent run executor defect"
 *      分支，同样 `failRun(..., "MODEL_CALL_FAILED")`）——这是我们的 bug，却和「模型没
 *      返回内容」在界面上不可分辨。
 *
 * ## 形态照抄 #3216（`standard-web-failure.ts`）
 *
 * 只上**枚举**，不上 provider 原话（原话可能带 prompt 片段/上游正文，那是把可分辨性
 * 换成泄漏）。认不出来就老实落 `unknown`——**不许**猜成 `provider_returned_empty`，
 * 那会把「我们自己坏了」说成「模型没给结果」，比不可分辨更糟。
 */
const DETAIL_RULES: ReadonlyArray<readonly [RegExp, AgentRunFailureReasonValue]> = [
  // `execute-run.ts:1224` —— 模型调用成功返回，但既无文本也无进度事件。
  [/provider returned neither content nor a progress event/i, "provider_returned_empty"],
  // `deep-agent-model-provider.ts` —— 远端 run 跑完了但没有 assistant 消息。
  [/succeeded but produced no assistant message/i, "provider_returned_empty"],
  // 远端 run 没能在预算内到达终态（`KERNEL_DEEP_AGENT_TIMEOUT_MS`）。
  [/did not reach a terminal state within/i, "provider_timeout"],
  // 远端 run 自己走到了 error/失败状态。
  [/run ended with status/i, "provider_rejected"],
  // 与内核/模型之间的 HTTP / 传输层失败。
  [/failed with HTTP \d+|transport failure/i, "provider_transport_failed"],
  // 我们这边的依赖没配好：调用根本没能正常发起。
  [/unavailable|not configured|configuration_invalid|_required$|persistence unavailable/i, "runtime_unavailable"],
];

/**
 * `ModelCallError.detail`（或任意异常的 `name: message`）→ 有界枚举。
 * `detail` 缺席或认不出 ⇒ `unknown`。
 */
export function classifyModelCallFailureReason(detail: string | null | undefined): AgentRunFailureReasonValue {
  if (typeof detail !== "string" || detail.trim() === "") return "unknown";
  for (const [pattern, reason] of DETAIL_RULES) if (pattern.test(detail)) return reason;
  return "unknown";
}
