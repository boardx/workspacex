/**
 * `listOrgInvites`（#363 delta）—— 邀请列表，只读，**仅组织 admin**。
 *
 * ⚠ 与 `listOrgMembers` **不共用同一条授权判定**——delta §4① 裁决：邀请列表比成员
 *   列表更敏感（未接受的邀请邮箱），收紧为仅 admin。`actorOrgRole` 由 controller
 *   从库里读出的会话主体角色传入，不信任请求体。
 */
import { OrgAdminError } from "./org-invite-errors";
import type { OrgId } from "../../domain/org-id";
import type { OrgInviteListRow, OrgProfileRepository } from "./org-profile-ports";

export interface ListOrgInvitesDeps {
  readonly repo: OrgProfileRepository;
}

export interface ListOrgInvitesInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
}

export interface ListOrgInvitesOutput {
  readonly invites: readonly OrgInviteListRow[];
}

export async function listOrgInvites(
  deps: ListOrgInvitesDeps,
  input: ListOrgInvitesInput,
): Promise<ListOrgInvitesOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  const invites = await deps.repo.listInvites(input.orgId);
  return { invites };
}
