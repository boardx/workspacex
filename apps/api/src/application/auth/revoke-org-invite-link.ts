/**
 * `RevokeOrgInviteLink` —— 手动作废（拍板①）。幂等；待复核的链接同样可作废。
 * 状态一翻，激活路径的 `status = 'active'` 判定当场失效——不需要动 token 行
 * （同 `revokeOrgInvite` 不动 `org_invite_tokens` 的推理）。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteLinkRepository } from "./org-invite-link-ports";

export interface RevokeOrgInviteLinkDeps {
  readonly repo: OrgInviteLinkRepository;
  readonly now?: () => Date;
}

export async function revokeOrgInviteLink(
  deps: RevokeOrgInviteLinkDeps,
  input: { readonly orgId: OrgId; readonly actorOrgRole: string; readonly linkId: string },
): Promise<{ readonly status: "revoked" }> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  const result = await deps.repo.revoke({
    orgId: input.orgId,
    linkId: input.linkId,
    now: (deps.now ?? (() => new Date()))(),
  });
  if (!result.ok) throw new OrgAdminError("INVITE_NOT_FOUND");
  return { status: result.status };
}
