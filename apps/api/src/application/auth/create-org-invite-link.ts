/** Create an immediately active ordinary-member shared invitation.
 * Tokens remain hashed at rest and expiry/count limits remain authoritative on acceptance.
 */
import {
  hashOrgInviteLinkToken,
  newOrgInviteLinkId,
  newOrgInviteLinkToken,
  ORG_INVITE_LINK_EXPIRY_MS,
  type OrgInviteLinkExpiryKind,
} from "../../domain/auth/org-invite-link";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteLinkRepository } from "./org-invite-link-ports";

export interface CreateOrgInviteLinkDeps {
  readonly repo: OrgInviteLinkRepository;
  readonly now?: () => Date;
}

export interface CreateOrgInviteLinkInput {
  readonly orgId: OrgId;
  /** Guard 认证过的调用者；组织角色由 identity 侧解析传入（invite-org-member 同款）。 */
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly orgRole: string;
  readonly expiry: OrgInviteLinkExpiryKind;
  readonly maxUses: number | null;
}

export interface CreateOrgInviteLinkOutput {
  readonly linkId: string;
  readonly status: "pending-review" | "active";
  /** 明文，只出现在这一次返回里；pending-review 时 null（令牌不存在）。 */
  readonly linkToken: string | null;
  readonly expiresAt: Date | null;
}

export async function createOrgInviteLink(
  deps: CreateOrgInviteLinkDeps,
  input: CreateOrgInviteLinkInput,
): Promise<CreateOrgInviteLinkOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();
  const token = newOrgInviteLinkToken();
  const expiresAt = new Date(now.getTime() + ORG_INVITE_LINK_EXPIRY_MS[input.expiry]);
  const linkId = newOrgInviteLinkId();

  await deps.repo.create({
    linkId,
    orgId: input.orgId,
    actorId: input.actorId,
    orgRole: "consultant",
    expiry: input.expiry,
    maxUses: input.maxUses,
    status: "active",
    tokenHash: hashOrgInviteLinkToken(token),
    expiresAt,
  });

  return { linkId, status: "active", linkToken: token, expiresAt };
}
