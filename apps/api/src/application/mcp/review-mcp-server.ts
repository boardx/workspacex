/**
 * `reviewMcpServer` -- F54 (UC-21.2 R3 步骤 2-4, R5, R12 V4): 放行评审流程.
 *
 * 写入顺序同 `set-security-policy.ts`：先 `provenance.append`（策略变更/评审结论都是
 * 高影响动作，R7 逐字要求留痕），成功后才落 `ReviewRecordStore.append` 与服务器状态。
 * `ReviewRecordStore` 本身没有 update/delete（见 `ports.ts`），"结论与理由不可删除"
 * 因此是一个**没有对应接口**的不变量，而不是一条运行时检查。
 */
import { evaluateMcpReview, reviewOutcomeStatus } from "../../domain/mcp/review-flow";
import type { ReviewVerdict, AuthScopeValue } from "../../domain/mcp/review-flow";
import type { ReviewStatus } from "../../domain/mcp/server-status";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ReviewRecordStore } from "./ports";
import type { OrgId } from "../../domain/org-id";

export interface McpServerFacts {
  readonly serverId: string;
  readonly registeredByActorId: string;
  readonly reviewStatus: ReviewStatus;
}

export interface ReviewMcpServerDeps {
  readonly reviews: ReviewRecordStore;
  readonly provenance: ProvenanceWriter;
  readonly requestId: { next(): string };
}

export interface ReviewMcpServerInput {
  readonly orgId: OrgId;
  readonly server: McpServerFacts;
  readonly reviewerId: string;
  readonly verdict: ReviewVerdict;
  readonly reason: string;
  readonly authScope: AuthScopeValue | null;
  readonly grantedToolIds: readonly string[];
}

export class McpReviewRejectedError extends Error {
  constructor(
    readonly reason:
      | "WRONG_REVIEW_FUNCTION"
      | "SELF_REVIEW_FORBIDDEN"
      | "REVIEW_REASON_REQUIRED"
      | "SCOPE_REQUIRED_ON_RELEASE",
  ) {
    super(reason);
  }
}

export interface ReviewMcpServerResult {
  readonly reviewId: string;
  readonly reviewStatus: ReturnType<typeof reviewOutcomeStatus>["reviewStatus"];
  readonly connectionStatus: ReturnType<typeof reviewOutcomeStatus>["connectionStatus"];
}

export async function reviewMcpServer(
  deps: ReviewMcpServerDeps,
  input: ReviewMcpServerInput,
): Promise<ReviewMcpServerResult> {
  const check = evaluateMcpReview({
    serverReviewStatus: input.server.reviewStatus,
    registeredByActorId: input.server.registeredByActorId,
    reviewerId: input.reviewerId,
    verdict: input.verdict,
    reason: input.reason,
    authScope: input.authScope,
  });
  if (!check.ok) throw new McpReviewRejectedError(check.reason);

  const outcome = reviewOutcomeStatus(input.verdict);
  const reviewId = deps.requestId.next();
  const at = new Date().toISOString();

  // 先留痕。
  await deps.provenance.append({
    orgId: input.orgId,
    type: "capability-updated",
    actorId: input.reviewerId,
    target: { kind: "capability", id: input.server.serverId },
    detail: {
      reviewId,
      verdict: input.verdict,
      reason: input.reason,
      authScope: input.authScope,
      grantedToolIds: input.grantedToolIds,
      resultingReviewStatus: outcome.reviewStatus,
      resultingConnectionStatus: outcome.connectionStatus,
    },
  });

  // 后落"评审记录"这份不可变副本。
  await deps.reviews.append({
    reviewId,
    serverId: input.server.serverId,
    reviewerId: input.reviewerId,
    at,
    verdict: input.verdict,
    reason: input.reason,
    grantedToolIds: input.grantedToolIds,
    authScopeSet: input.authScope,
  });

  return { reviewId, reviewStatus: outcome.reviewStatus, connectionStatus: outcome.connectionStatus };
}
