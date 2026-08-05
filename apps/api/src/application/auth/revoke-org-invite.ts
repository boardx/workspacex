/**
 * `RevokeOrgInvite`（#363）—— 编排。不知道 HTTP，不知道 PostgreSQL。
 *
 * 契约 `org-admin.ts:357` 早就存在、controller 里零命中，本 feature 把它接上。
 * 规则的出处：契约那一行逐字写着「**撤销是幂等的**：重复撤销返回同一 `revoked` 状态」。
 *
 * ## 撤销之后那条链接为什么当场失效
 *
 * 不在这里做任何令牌操作。激活路径第 (3) 步逐字要求 `status = 'pending'`
 * （`pg-org-invite-repository.ts`，注释里已经点名了「管理员在激活途中撤销了邀请
 * ⇒ 行还在、status 变成 revoked ⇒ 这里零行 ⇒ 当前步骤立即失败（E7）」）。
 * ⇒ 撤销要做的全部事情就是把 status 翻过去；再去 consume 一遍令牌不会让任何一条链接
 *   更早失效，只会多一处必须与激活路径保持一致的判断。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteRepository } from "./org-invite-ports";

export interface RevokeOrgInviteDeps {
  readonly repo: OrgInviteRepository;
  readonly now?: () => Date;
}

export interface RevokeOrgInviteInputUc {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly inviteId: string;
}

export interface RevokeOrgInviteOutput {
  readonly status: "revoked";
}

export async function revokeOrgInvite(
  deps: RevokeOrgInviteDeps,
  input: RevokeOrgInviteInputUc,
): Promise<RevokeOrgInviteOutput> {
  // 🔴 授权，且**在任何一次按 inviteId 的查库之前**——理由见 `resend-org-invite.ts`
  //   的同一行注释：防枚举不是错误码长得像，是判定顺序。
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();

  const result = await deps.repo.revokeOrgInvite({
    orgId: input.orgId,
    inviteId: input.inviteId,
    actorId: input.actorId,
    now,
  });

  if (!result.ok) {
    if (result.reason === "not-found") throw new OrgAdminError("INVITE_NOT_FOUND");
    // `already-used`：人已经进来了。撤销邀请不会把他踢出组织（那是 removeOrgMember），
    // 所以这不是一次「幂等成功」，是一次状态已翻。
    throw new OrgAdminError("VERSION_CHANGED");
  }

  return { status: result.status };
}
