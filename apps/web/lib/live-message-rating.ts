/**
 * F176 —— 消息级评价的真实 API 薄封装（F68 契约 `rateMessage`）。
 *
 * ⚠ **请求体里没有归因**，这不是省略。契约的 `rateMessage.in` 是
 *   `{ messageId, verdict, reason }` 且 `.strict()`：归因由服务端从 `agent_runs`
 *   查出来。前端能传归因，就等于任何用户都能给任意 skill 版本刷满意度，
 *   而刷出来的数字与真实数字长得一模一样，没有任何下游能分辨。
 *   所以这个函数的签名里**不存在**可以传归因的参数——不是「传了会被忽略」。
 *
 * 类型走 `z.infer`（`lint-contract-source` 要求）。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type RatingVerdict = z.infer<typeof skills.RatingVerdict>;
export type RateMessageOut = z.infer<typeof skills.operations.rateMessage.out>;

export async function rateMessage(input: {
  readonly messageId: string;
  readonly verdict: RatingVerdict;
  readonly reason: string | null;
}): Promise<RateMessageOut> {
  return apiRequest<RateMessageOut>(
    `/messages/${encodeURIComponent(input.messageId)}/rating`,
    { method: "POST", body: { messageId: input.messageId, verdict: input.verdict, reason: input.reason } },
  );
}
