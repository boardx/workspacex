/**
 * `ListOrgInviteLinks` —— 链接列表，仅组织 admin（与 `listOrgInvites` 同一收窄取向）。
 * 恒不含令牌：明文在库里不存在，hash 不出仓储（端口注释）。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteLinkRepository, OrgInviteLinkRow } from "./org-invite-link-ports";

export interface ListOrgInviteLinksDeps {
  readonly repo: OrgInviteLinkRepository;
  readonly now?: () => Date;
}

export async function listOrgInviteLinks(
  deps: ListOrgInviteLinksDeps,
  input: { readonly orgId: OrgId; readonly actorOrgRole: string },
): Promise<OrgInviteLinkRow[]> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  return deps.repo.list(input.orgId, (deps.now ?? (() => new Date()))());
}
