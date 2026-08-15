/**
 * FB-2 —— 反馈的真实 API 薄封装（契约 `feedback-loop`）。
 *
 * 类型全部走 `z.infer`（`lint-contract-source` 要求）：这里**不重新声明**任何一个
 * 字段名或枚举值。反馈的类型/状态/目标三件事只在契约里写过一遍。
 *
 * ⚠ **请求体里没有 `submittedBy`、没有 `status`**，这不是省略。契约的
 *   `submitFeedback.in` 是 `.strict()` 的，提交人从 principal 取、状态恒 `待处理`。
 *   前端能传状态，就等于任何人能把自己的反馈直接标成「已修复」。
 *   所以这个函数的签名里**不存在**那两个参数——不是「传了会被忽略」。
 */
import { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type FeedbackKind = z.infer<typeof feedbackLoop.FeedbackKind>;
export type FeedbackStatus = z.infer<typeof feedbackLoop.FeedbackStatus>;
export type FeedbackTarget = z.infer<typeof feedbackLoop.FeedbackTarget>;
export type FeedbackItem = z.infer<typeof feedbackLoop.FeedbackItem>;
export type SubmitFeedbackOut = z.infer<typeof feedbackLoop.operations.submitFeedback.out>;
export type VoteFeedbackOut = z.infer<typeof feedbackLoop.operations.voteFeedback.out>;
export type FeedbackCounts = z.infer<typeof feedbackLoop.operations.getFeedbackCounts.out>;

/** 枚举的**唯一来源**——下拉框、徽标色映射、测试断言都从这里取，不各写一份数组。 */
export const FEEDBACK_KINDS = feedbackLoop.FeedbackKind.options;
export const FEEDBACK_STATUSES = feedbackLoop.FeedbackStatus.options;

export async function submitFeedback(input: {
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly title: string;
  readonly detail: string;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
}): Promise<SubmitFeedbackOut> {
  return apiRequest<SubmitFeedbackOut>("/feedback", { method: "POST", body: input });
}

/**
 * ⚠ query 是**拍平的**（`scope` / `targetKind` / `targetId`），服务端再组装回契约的
 *   判别联合并重新校验。URL query 只能是平的键值对，这是 HTTP 的限制，不是契约的让步。
 */
export async function listFeedback(
  scope:
    | { readonly kind: "mine" }
    | { readonly kind: "org" }
    | { readonly kind: "target"; readonly target: FeedbackTarget },
): Promise<readonly FeedbackItem[]> {
  const query: Record<string, string | undefined> = { scope: scope.kind };
  if (scope.kind === "target") {
    query.targetKind = scope.target.kind;
    query.targetId =
      scope.target.kind === "agent"
        ? scope.target.agentId
        : scope.target.kind === "skill"
          ? scope.target.skillId
          : undefined;
  }
  const out = await apiRequest<{ items: FeedbackItem[] }>("/feedback", { query });
  return out.items;
}

/**
 * ⚠ 用服务端回的 `votes` 覆盖本地，**不做乐观 +1**。票数的口径是 `COUNT(*)`；
 *   本地加一在并发下就是错的，而错的那个数字看起来完全正常。
 */
export async function voteFeedback(feedbackId: string, voted: boolean): Promise<VoteFeedbackOut> {
  return apiRequest<VoteFeedbackOut>(`/feedback/${encodeURIComponent(feedbackId)}/vote`, {
    method: "POST",
    body: { feedbackId, voted },
  });
}

export async function triageFeedback(
  feedbackId: string,
  status: FeedbackStatus,
  reason: string | null,
): Promise<{ feedbackId: string; status: FeedbackStatus }> {
  return apiRequest(`/feedback/${encodeURIComponent(feedbackId)}/status`, {
    method: "PUT",
    body: { feedbackId, status, reason },
  });
}

export async function getFeedbackCounts(): Promise<FeedbackCounts> {
  return apiRequest<FeedbackCounts>("/feedback/counts");
}

/**
 * 应用版本（I-F1 的一半）。
 *
 * ⚠ 读不到就是 `null`，**不编一个 `"unknown"` 或 `"0.0.0"`**：一个假的版本号会让
 *   「这个 bug 是哪个构建引入的」这类排查走进一条不存在的线索，
 *   而 `null` 至少诚实地说「这条反馈没带版本」。
 */
export function currentAppVersion(): string | null {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? null;
}
