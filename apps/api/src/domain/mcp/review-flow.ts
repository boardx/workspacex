/**
 * F54 (UC-21.2 R3 步骤 2-4 / R12 V4) -- 放行评审流程的纯判定.
 *
 * 判定顺序本身是判据的一部分（与 `authorize-layer1.ts` 同一纪律）：
 * 1. **函数用对了吗**——对一台已经 `已放行` 的服务器再走"评审"，说明调用方该用
 *    `reIsolateMcpServer` 而不是这里；契约的 `WRONG_REVIEW_FUNCTION` 码就是为这个准备的。
 * 2. **评审人 ≠ 注册人**（E1）——不得自审自批。
 * 3. **理由必填**（R7 逐字"结论必须填理由"）——`z.string().min(1)` 在契约层已经挡住空串，
 *    这里额外挡纯空白（`"   "`），因为 zod 的 `min(1)` 不算字符语义只算长度。
 * 4. **放行必须同时设定授权范围**（I-25 / E2）——不允许"已连接但范围未定"的空档。
 *
 * ⚠ 本文件**不**处理"结论与理由不可删除"（R7 / R12 V4 的另一半）——那是一个**没有对应
 *   写接口**的不变量（契约里没有 `deleteReview` / `updateReview` 操作），落点在
 *   application 层的 `ReviewRecordStore`（只有 `append`，没有 `update`/`delete`），
 *   与 `provenance_events` 的 append-only 同一种"不变量=接口缺失"的表达方式。
 */
import type { McpReviewVerdict, ToolAuthScope } from "@repo/contracts/agent-runtime";
import type { z } from "zod";
import type { ReviewStatus } from "./server-status";

export type ReviewVerdict = z.infer<typeof McpReviewVerdict>;
export type AuthScopeValue = z.infer<typeof ToolAuthScope>;

export interface ReviewAttempt {
  readonly serverReviewStatus: ReviewStatus;
  readonly registeredByActorId: string;
  readonly reviewerId: string;
  readonly verdict: ReviewVerdict;
  readonly reason: string;
  readonly authScope: AuthScopeValue | null;
}

export type ReviewCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "WRONG_REVIEW_FUNCTION"
        | "SELF_REVIEW_FORBIDDEN"
        | "REVIEW_REASON_REQUIRED"
        | "SCOPE_REQUIRED_ON_RELEASE";
    };

/** 只有这三种状态"处在待评审的世界里"；`已放行` 应改走重新隔离，其余（已隔离外的运行态字段）不归本函数管。 */
const REVIEWABLE_STATUSES: readonly ReviewStatus[] = ["待安全评审", "维持隔离", "已到期待复核"];

export function evaluateMcpReview(attempt: ReviewAttempt): ReviewCheckResult {
  if (!REVIEWABLE_STATUSES.includes(attempt.serverReviewStatus)) {
    return { ok: false, reason: "WRONG_REVIEW_FUNCTION" };
  }
  if (attempt.reviewerId === attempt.registeredByActorId) {
    return { ok: false, reason: "SELF_REVIEW_FORBIDDEN" };
  }
  if (attempt.reason.trim().length === 0) {
    return { ok: false, reason: "REVIEW_REASON_REQUIRED" };
  }
  if (attempt.verdict === "放行" && attempt.authScope === null) {
    return { ok: false, reason: "SCOPE_REQUIRED_ON_RELEASE" };
  }
  return { ok: true };
}

/**
 * 结论 → 服务器新状态的唯一映射（R3 步骤 3）。
 * ⚠ `有条件放行` 时 `connectionStatus` 仍转 `已连接`——是**部分工具**可用而非服务器整体
 *   不可用；未放行的工具由 `grantedToolIds` 之外的集合在上层被挡（V5，[待定]粒度）。
 */
export function reviewOutcomeStatus(verdict: ReviewVerdict): {
  reviewStatus: ReviewStatus;
  connectionStatus: "已连接" | "已隔离";
} {
  switch (verdict) {
    case "放行":
      return { reviewStatus: "已放行", connectionStatus: "已连接" };
    case "有条件放行":
      return { reviewStatus: "有条件放行", connectionStatus: "已连接" };
    case "维持隔离":
      return { reviewStatus: "维持隔离", connectionStatus: "已隔离" };
  }
}
