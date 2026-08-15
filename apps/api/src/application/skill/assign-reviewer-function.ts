/**
 * `assignSkillReviewerFunction` —— issue #852 delta（skill-reviewer-function-assignment）。
 *
 * 组织管理员任命一名成员为 `methodology-reviewer` / `security-reviewer`。在这个用例
 * 之前，`skill_reviewer_functions` 全仓零生产写入方——`functionOf()` 在任何新组织里
 * 恒返回 null，`reviewSkillVersion` 因此永远拿不到非 null 的 `reviewerFunction`，
 * 一个刚注册的管理员在自己的新组织里造不出一个「已启用」的 skill。
 *
 * ## 授权判定放在这里，不放在 controller
 *
 * `requireAdminRole` 只解析「调用者在这个组织的角色是什么」，`orgRole !== "admin"`
 * 的判定在用例里做（同 `remove-org-member.ts` 的既定分工：controller 负责取事实，
 * 用例负责判定）——这样这条规则只有一处，测试也直接测这个函数就够。
 *
 * ## `MEMBER_NOT_FOUND` 判定顺序
 *
 * 先判管理员权限，再判目标是否是本组织成员：非 admin 拿一个不存在的 userId 调用，
 * 得到的是 `PROJECT_ROLE_INSUFFICIENT`（权限判定先跑完），不是 `MEMBER_NOT_FOUND`——
 * 后者会向非 admin 泄露「这个 userId 在不在本组织」这一位信息，同 `resend`/`revoke`
 * 邀请那份「判定顺序防枚举」的既定纪律（`skill-review.controller.ts` 文件头引用的同一原则）。
 */
import { OrgAdminError } from "../auth/org-invite-errors";
import type { ReviewerFunctionPort } from "./ports";
import type { ReviewerFunctionValue } from "../../domain/skill/review-authorization";

export interface AssignReviewerFunctionInput {
  readonly actorOrgRole: string;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly reviewerFunction: ReviewerFunctionValue;
}

export interface AssignReviewerFunctionDeps {
  readonly reviewerFunctions: ReviewerFunctionPort;
  /** 目标 userId 是否是本组织成员——由 controller 已经查好的事实传入,不在用例里再查一次库。 */
  readonly targetIsMember: boolean;
}

export interface AssignReviewerFunctionOutput {
  readonly userId: string;
  readonly reviewerFunction: ReviewerFunctionValue;
  readonly assignedBy: string;
  readonly assignedAt: string;
}

export async function assignSkillReviewerFunction(
  input: AssignReviewerFunctionInput,
  deps: AssignReviewerFunctionDeps,
): Promise<AssignReviewerFunctionOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  if (!deps.targetIsMember) throw new OrgAdminError("MEMBER_NOT_FOUND");

  const { assignedAt } = await deps.reviewerFunctions.assignReviewerFunction({
    principalId: input.targetUserId,
    reviewerFunction: input.reviewerFunction,
    assignedBy: input.actorId,
  });

  return {
    userId: input.targetUserId,
    reviewerFunction: input.reviewerFunction,
    assignedBy: input.actorId,
    assignedAt,
  };
}
