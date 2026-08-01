/**
 * `reviewSkillVersion` 的**人员维度**门禁（F62；I-4/I-5，`domain.md`）。
 *
 * `security-gate.ts` 回答的是「扫描/门禁过了吗，状态机能不能走这条边」——
 * 完全不知道**谁**在按下 approve。本文件回答另一半问题：**这个人有没有资格
 * 按下这个 approve**，与扫描结果、状态机边完全正交（一个 skill 可能双重门禁
 * 都齐全，仍然因为审核人不合资格而被拒——两者是 AND 关系，不是二选一）。
 *
 * 三条判据，**优先级固定**（谁在前谁决定最终错误码，见 `authorizeReview` 注释）：
 *   ① 职能对不对——`methodologyReviewer` 才能批 skill；`securityReviewer` 调用本用例
 *      本身就是「两职能不合并」的越权尝试 ⇒ `REVIEWER_FUNCTION_MISMATCH`（I-5）。
 *   ② 提交人 ≠ 审核人——`SELF_REVIEW_FORBIDDEN`（I-4）。
 *   ③ 若提交人正是唯一持有 `methodology-reviewer` 职能的人（组织没配第二个人），
 *      ②本可以被"换个人审"化解，但这里换不了 ⇒ 这不是操作错误而是组织配置问题，
 *      改判 `NO_SECOND_REVIEWER`（A4）——两码分开正是为了让界面文案不同：
 *      前者提示"找另一位审核人"，后者提示"找组织管理员再指派一名审核人"。
 */
import type { SkillErrorCode } from "./declarative-contract";

export type ReviewerFunctionValue = "methodology-reviewer" | "security-reviewer";

export interface ReviewAuthorizationInput {
  readonly submitterId: string;
  readonly reviewerId: string;
  /** `null` ⇒ 该 principal 未被组织管理员指派任何评审职能 */
  readonly reviewerFunction: ReviewerFunctionValue | null;
  /**
   * 组织内，除 `reviewerId` 以外，是否还存在**至少一名**持有
   * `methodology-reviewer` 职能的人。⚠ 只在「提交人=审核人」分支下被读取——
   * 不是提交人自审时，这条与判定无关，调用方不需要为每次评审都算一遍。
   */
  readonly anotherMethodologyReviewerExists: boolean;
}

export type ReviewAuthorizationVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: SkillErrorCode; readonly reason: string };

export function authorizeReview(input: ReviewAuthorizationInput): ReviewAuthorizationVerdict {
  // ① 职能不对：安全评审人（或未被指派任何职能的人）调用「批准发布 skill」，
  //    与「方法论审核人裁工具白名单越权申请」是同一条纪律在 skill 侧的镜像（I-5）。
  if (input.reviewerFunction !== "methodology-reviewer") {
    return {
      allowed: false,
      code: "REVIEWER_FUNCTION_MISMATCH",
      reason:
        input.reviewerFunction === "security-reviewer"
          ? "安全评审人不能批准发布 skill：两职能不合并，方法论审核与安全评审是两条并列的会签线（I-5）"
          : "该 principal 未被组织管理员指派方法论审核职能，无权裁决本次评审",
    };
  }

  // ② 提交人 = 审核人。
  if (input.submitterId === input.reviewerId) {
    // ③ 换个人审是否可行——可行是操作错误，不可行是组织配置问题（A4）。
    if (input.anotherMethodologyReviewerExists) {
      return {
        allowed: false,
        code: "SELF_REVIEW_FORBIDDEN",
        reason: "提交人不能审核自己提交的 skill：请另一名方法论审核人处理",
      };
    }
    return {
      allowed: false,
      code: "NO_SECOND_REVIEWER",
      reason:
        "组织内没有第二名方法论审核人：这是组织配置问题，需组织管理员再指派一名审核人，而不是换个人重试",
    };
  }

  return { allowed: true };
}
