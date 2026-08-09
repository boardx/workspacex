/**
 * `listOrgMembers`（#363 delta）—— 成员列表，只读。
 *
 * ⚠ 与 `listTeams` 同一处置：**不要求 `actorOrgRole === "admin"`**——delta §2 逐字，
 *   看到组织里有谁不是敏感操作。调用方在 controller 层已经确认过组织成员身份
 *   （`requireAdminRole`，其实只检查成员资格），这里不重复判定。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgMemberListRow, OrgProfileRepository } from "./org-profile-ports";

export interface ListOrgMembersDeps {
  readonly repo: OrgProfileRepository;
}

export interface ListOrgMembersInput {
  readonly orgId: OrgId;
}

export interface ListOrgMembersOutput {
  readonly members: readonly OrgMemberListRow[];
}

export async function listOrgMembers(
  deps: ListOrgMembersDeps,
  input: ListOrgMembersInput,
): Promise<ListOrgMembersOutput> {
  const members = await deps.repo.listMembers(input.orgId);
  return { members };
}
