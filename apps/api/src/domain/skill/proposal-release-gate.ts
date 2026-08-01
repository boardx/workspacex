/**
 * 改进提案上线门禁（F68；UC-3.6 R3 阶段四，R7「人工复核是必经环节」的结构性落点）。
 *
 * 与 `security-gate.ts`（F61/F62 的 skill 状态机门禁）和 `review-authorization.ts`
 * （谁有资格审）都正交：本文件只回答第三个问题——**这份提案本身**能不能被置为上线。
 *
 * ⚠ `reviewDecision !== "approved"` 时直接拒绝且**不看** `schemaBreaking`——
 *   「没复核」永远排在「复核过但没确认破坏性变更」前面，界面文案需要能区分
 *   「你还没走复核」与「复核过但有一步没做」，与 `review-skill-version.ts` 头注释
 *   同一种「谁在前谁决定最终错误码」的纪律。
 */
import type { SkillErrorCode } from "./declarative-contract";

export interface ProposalReleaseGateState {
  readonly reviewDecision: "approved" | "rejected" | "not-reviewed";
  readonly schemaBreaking: boolean;
  readonly schemaBreakingAcknowledged: boolean;
}

export type ProposalReleaseVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: SkillErrorCode; readonly reason: string };

export function authorizeProposalRelease(state: ProposalReleaseGateState): ProposalReleaseVerdict {
  if (state.reviewDecision !== "approved") {
    return {
      allowed: false,
      code: "PROPOSAL_NOT_REVIEWED",
      reason:
        "改进提案未经人工复核通过，不得上线——AI 生成的改进提案不得自动上线（R7，与 UC-3.5 同源）",
    };
  }

  if (state.schemaBreaking && !state.schemaBreakingAcknowledged) {
    return {
      allowed: false,
      code: "SCHEMA_BREAKING_UNACKNOWLEDGED",
      reason: "该改进破坏输入输出 schema 兼容性，须在复核界面显式确认后才能发布（E3/V8）",
    };
  }

  return { allowed: true };
}
