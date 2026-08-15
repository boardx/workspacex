/**
 * `listSkillReviewerFunctions` —— issue #852 delta（skill-reviewer-function-assignment）。
 * 仅 admin 可读的组织内全部审核人职能指派名单，供 `/admin` 成员页渲染「谁已经是审核人」。
 * ⚠ 与 `anotherMethodologyReviewerExists` 刻意不同——那个端口只回答布尔值，不列名单，
 *   因为它的调用者是提交人视角；这里的调用者是 admin 视角，列名单本身就是这条 UC 的目的。
 */
import { OrgAdminError } from "../auth/org-invite-errors";
import type { ReviewerFunctionPort } from "./ports";
import type { ReviewerFunctionValue } from "../../domain/skill/review-authorization";

export interface ListReviewerFunctionsInput {
  readonly actorOrgRole: string;
}

export interface ReviewerFunctionAssignment {
  readonly userId: string;
  readonly reviewerFunction: ReviewerFunctionValue;
  readonly assignedBy: string;
  readonly assignedAt: string;
}

export async function listSkillReviewerFunctions(
  input: ListReviewerFunctionsInput,
  deps: { readonly reviewerFunctions: ReviewerFunctionPort },
): Promise<{ readonly assignments: readonly ReviewerFunctionAssignment[] }> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const rows = await deps.reviewerFunctions.listReviewerFunctions();
  return {
    assignments: rows.map((row) => ({
      userId: row.principalId,
      reviewerFunction: row.reviewerFunction,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
    })),
  };
}
