/**
 * `revokeSkillReviewerFunction` —— issue #852 delta（skill-reviewer-function-assignment）。
 * 撤销一名成员的审核人职能，回到「无职能」。见 `assign-reviewer-function.ts` 文件头
 * 关于授权判定顺序与 `MEMBER_NOT_FOUND` 的说明——同一条纪律，不重复第二遍。
 */
import { OrgAdminError } from "../auth/org-invite-errors";
import type { ReviewerFunctionPort } from "./ports";

export interface RevokeReviewerFunctionInput {
  readonly actorOrgRole: string;
  readonly targetUserId: string;
}

export interface RevokeReviewerFunctionDeps {
  readonly reviewerFunctions: ReviewerFunctionPort;
  readonly targetIsMember: boolean;
}

export interface RevokeReviewerFunctionOutput {
  readonly userId: string;
  readonly revoked: true;
}

export async function revokeSkillReviewerFunction(
  input: RevokeReviewerFunctionInput,
  deps: RevokeReviewerFunctionDeps,
): Promise<RevokeReviewerFunctionOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  if (!deps.targetIsMember) throw new OrgAdminError("MEMBER_NOT_FOUND");

  const { revoked } = await deps.reviewerFunctions.revokeReviewerFunction(input.targetUserId);
  if (!revoked) throw new OrgAdminError("NOT_ASSIGNED");

  return { userId: input.targetUserId, revoked: true };
}
