/**
 * `AcceptProjectInvite`（项目中枢 R2，用户直接交办 2026-09-27）——已登录的组织成员用一条
 * 项目邀请链接把自己加进项目。
 *
 * ## 为什么是一个用例而不是两枪
 *
 * 此前「令牌 → 成员行」被拆成两半：F15 `consumeInviteLink` 只把令牌换成授予值、显式不落
 * 成员行（其头注：「谁拿它去建什么是下一个 feature 的事」）；F125 `addProjectMember(subject:
 * inviteToken)` 又要求令牌**已经**被核销过（`used_by IS NOT NULL`），且调用者必须是能管成员的
 * 引导师。于是一个拿到链接的普通成员没有任何一条路径能把自己加进项目——「项目是受邀才能进的
 * 容器」在契约上有、在产品里走不通。本用例把两半接成一条：核销 + 落行，调用者是被邀请的人自己。
 *
 * ## 判定顺序
 *
 *   1. 调用者必须已是本组织成员（`NO_ORG_MEMBERSHIP`）——项目层的邀请不能顺带发组织成员资格，
 *      那是 UC-1.6 组织邀请的事。
 *   2. `consumeInviteLink`：一次性 / 撤销 / 过期 / 不存在四态由 F15 那一条 WHERE 决定，这里不重判。
 *   3. 令牌所属组织 ≠ principal 所在组织 ⇒ `INVITE_NOT_FOUND`（不泄露别的组织有没有这条链接）。
 *   4. `members.addMember`：`already-member` **不是错误**（幂等，`alreadyMember: true`）；
 *      `archived` ⇒ `FORBIDDEN`；`not-found`（项目已不存在）⇒ `INVITE_NOT_FOUND`。
 *
 * ⚠ 已知取舍：一次性链接在第 2 步已被标记 `used_by`，若第 4 步落行失败（项目归档），
 *   该链接不会回滚为未用——两步不在同一事务里（仓储各自开事务）。归档项目本就不该再发链接，
 *   这条路径的代价是「引导师重发一条」，不是数据错。
 */
import { consumeInviteLink } from "../auth/consume-invite-link";
import type { InviteLinkRepository } from "../auth/invite-link-ports";
import { OrgAdminError } from "../auth/org-invite-errors";
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";
import type { ProjectMembershipRepository } from "./member-ports";

export interface AcceptProjectInviteDeps {
  readonly links: InviteLinkRepository;
  readonly members: ProjectMembershipRepository;
  readonly identity: IdentityRepository;
  readonly now?: () => Date;
}

export interface AcceptProjectInviteInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /** `null` / 空串 = 请求里没带令牌，由 `consumeInviteLink` 判成 `LINK_TOKEN_REQUIRED`。 */
  readonly token: string | null;
}

export interface AcceptProjectInviteOutput {
  readonly projectId: string;
  readonly projectRole: ProjectRole;
  readonly groupId: string | null;
  readonly alreadyMember: boolean;
}

export async function acceptProjectInvite(
  deps: AcceptProjectInviteDeps,
  input: AcceptProjectInviteInput,
): Promise<AcceptProjectInviteOutput> {
  const orgMembership = await deps.identity.findOrgMembership(input.userId, input.orgId);
  if (orgMembership === null) throw new OrgAdminError("NO_ORG_MEMBERSHIP");

  const grant = await consumeInviteLink(
    { repo: deps.links, now: deps.now },
    { token: input.token, principalId: input.userId },
  );
  if (grant.orgId !== input.orgId) throw new OrgAdminError("INVITE_NOT_FOUND");

  const outcome = await deps.members.addMember({
    orgId: input.orgId,
    projectId: grant.projectId,
    userId: input.userId,
    projectRole: grant.projectRole,
    isHost: false,
    groupId: grant.groupId,
  });

  switch (outcome.kind) {
    case "added":
      return { projectId: grant.projectId, projectRole: grant.projectRole, groupId: grant.groupId, alreadyMember: false };
    case "already-member":
      return { projectId: grant.projectId, projectRole: grant.projectRole, groupId: grant.groupId, alreadyMember: true };
    case "archived":
      throw new OrgAdminError("FORBIDDEN");
    case "not-found":
      throw new OrgAdminError("INVITE_NOT_FOUND");
  }
}
