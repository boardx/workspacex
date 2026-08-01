/**
 * `reviewProposal` —— 改进提案的人工复核（F68；UC-3.6 R3 阶段四步骤 7）。
 *
 * 合成两个正交判定，同 `review-skill-version.ts`（F62）的既有纪律：
 *   ① **人员维度**（`review-authorization.ts` 复用）——提交人 ≠ 审核人、职能须为
 *      `methodology-reviewer`；不合资格**不再往下问**门禁/schema 破坏性。
 *   ② **提案释放维度**（`proposal-release-gate.ts`）——复核结论是否已批准、
 *      schema 破坏性是否被显式确认。
 *
 * `decision: "reject"` 分支**不**触发发版：提案停留在待复核前的版本状态，
 * 附理由返回，供界面提示"退回，请修改后重新提交"。
 */
import { authorizeReview, type ReviewerFunctionValue } from "../../domain/skill/review-authorization";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import { releaseProposal } from "./release-proposal";
import type { SkillVersionSnapshot } from "../../domain/skill/version-chain";
import type { SecurityAuditPort, SkillVersionStorePort } from "./ports";

export interface ReviewProposalInput {
  readonly proposalId: string;
  readonly skillId: string;
  /** 提案对应的 `vN+1` 版本 id（生成时落的 `draftVersionId`） */
  readonly versionId: string;
  readonly expectedHeadVersionId: string | null;
  /** 提案提交人——来自提案记录，不是入参可篡改的字段 */
  readonly submitterId: string;
  /** 已由 Guard 认证过的调用者，同 `review-skill-version.ts` 既有纪律 */
  readonly reviewerId: string;
  readonly reviewerFunction: ReviewerFunctionValue | null;
  readonly anotherMethodologyReviewerExists: boolean;
  readonly decision: "approve" | "reject";
  readonly schemaBreaking: boolean;
  /** 复核界面上人工勾选的「我已知晓这条改动破坏兼容性」确认位（E3/V8） */
  readonly schemaBreakingAck: boolean;
}

export type ReviewProposalResult =
  | { readonly ok: true; readonly decision: "reject"; readonly reason: string }
  | {
      readonly ok: true;
      readonly decision: "approve";
      readonly released: SkillVersionSnapshot;
      readonly archivedVersionId: string | null;
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export async function reviewProposal(
  input: ReviewProposalInput,
  deps: { readonly versions: SkillVersionStorePort; readonly audit: SecurityAuditPort },
): Promise<ReviewProposalResult> {
  const authz = authorizeReview({
    submitterId: input.submitterId,
    reviewerId: input.reviewerId,
    reviewerFunction: input.reviewerFunction,
    anotherMethodologyReviewerExists: input.anotherMethodologyReviewerExists,
  });

  if (!authz.allowed) {
    return { ok: false, code: authz.code as SkillErrorCode, reason: authz.reason };
  }

  if (input.decision === "reject") {
    return { ok: true, decision: "reject", reason: "复核未通过：提案退回，vN 保持生效" };
  }

  const released = await releaseProposal(
    {
      proposalId: input.proposalId,
      skillId: input.skillId,
      versionId: input.versionId,
      principalId: input.reviewerId,
      expectedHeadVersionId: input.expectedHeadVersionId,
      gate: {
        reviewDecision: "approved",
        schemaBreaking: input.schemaBreaking,
        schemaBreakingAcknowledged: input.schemaBreakingAck,
      },
    },
    { versions: deps.versions, audit: deps.audit },
  );

  if (!released.ok) {
    return { ok: false, code: released.code, reason: "reason" in released ? released.reason : "" };
  }

  return { ok: true, decision: "approve", released: released.released, archivedVersionId: released.archivedVersionId };
}
