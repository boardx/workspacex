/**
 * `reviewSkillVersion` —— 人工门禁的**唯一用例**（F62；`usecases.md` 门禁第二道）。
 *
 * 把两个正交的判定合成一次调用：
 *   ① **人员维度**（`review-authorization.ts`，I-4/I-5）——这个人有没有资格按下这个 approve/reject。
 *   ② **门禁/状态机维度**（`security-gate.ts` 经 `advance-skill-status.ts`，I-3/I-23/AC2）——
 *      两道门禁是否齐全、这条边是否存在。
 *
 * 两者是 **AND** 关系，谁在前谁决定最终错误码：先问「这个人能不能审」，
 * 人员维度不过直接返回，**不再往下问门禁**——一个安全评审人调用本用例，
 * 不该因为「门禁本来就没过」而得到 `GATE_NOT_PASSED`，那会掩盖「你根本没资格审」这件事。
 *
 * ⚠ `decision` 直接决定人工门禁记录本身：
 *   `approve` ⇒ `methodologyReview = { approved: true }` 且状态机边是 `待审核 → 已启用`；
 *   `reject`  ⇒ `methodologyReview = { approved: false }` 且状态机边是 `待审核 → 草稿`
 *   （`rejectedToDraftLosesDistinction()` 的已知代价在这条边上发生，见 `skill-status.ts`）。
 *   `reject` 分支不问 `gatesAllowEnable`——那条判据只在 `to === "已启用"` 时生效。
 */
import {
  authorizeReview,
  type ReviewerFunctionValue,
} from "../../domain/skill/review-authorization";
import type { SecurityScanResult } from "../../domain/skill/security-gate";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import { advanceSkillStatus, type AdvanceSkillStatusResult } from "./advance-skill-status";
import type { SecurityAuditPort } from "./ports";

export interface ReviewSkillVersionInput {
  readonly skillId: string;
  /** 该版本的提交人（草稿作者），来自版本记录，不是入参可篡改的字段 */
  readonly submitterId: string;
  /** 已由 Guard 认证过的调用者——同 `review-admin-invite.ts` 的既有纪律,绝不从请求体取 */
  readonly reviewerId: string;
  /** `null` ⇒ 该 principal 未被组织管理员指派任何评审职能 */
  readonly reviewerFunction: ReviewerFunctionValue | null;
  /** 仅「提交人 = 审核人」分支下被读取，见 `review-authorization.ts` 注释 */
  readonly anotherMethodologyReviewerExists: boolean;
  readonly decision: "approve" | "reject";
  /** ⚠ 恒为 `"待审核"`——本用例是门禁第二道，唯一合法前驱由 `skill-status.ts` 状态机钉死 */
  readonly from: SkillLifecycleStatus;
  /** 安全扫描（门禁第一道）的结论；`reject` 分支不参与判定，仍要求传入以便日志完整 */
  readonly scan: SecurityScanResult | null;
  readonly acknowledgedRiskItemIds: readonly string[];
}

export type ReviewSkillVersionResult = AdvanceSkillStatusResult;

export async function reviewSkillVersion(
  input: ReviewSkillVersionInput,
  deps: { readonly audit: SecurityAuditPort },
): Promise<ReviewSkillVersionResult> {
  const authz = authorizeReview({
    submitterId: input.submitterId,
    reviewerId: input.reviewerId,
    reviewerFunction: input.reviewerFunction,
    anotherMethodologyReviewerExists: input.anotherMethodologyReviewerExists,
  });

  if (!authz.allowed) {
    // 人员维度不过，**不再问门禁**——见文件头注释：这不是「门禁没过」，是「这个人没资格审」。
    return {
      ok: false,
      code: authz.code as SkillErrorCode,
      reason: authz.reason,
      status: input.from,
      auditWritten: false,
    };
  }

  const to: SkillLifecycleStatus = input.decision === "approve" ? "已启用" : "草稿";

  return advanceSkillStatus(
    {
      skillId: input.skillId,
      principalId: input.reviewerId,
      from: input.from,
      to,
      gates: {
        scan: input.scan,
        methodologyReview: { approved: input.decision === "approve" },
        acknowledgedRiskItemIds: input.acknowledgedRiskItemIds,
      },
    },
    { audit: deps.audit },
  );
}
