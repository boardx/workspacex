/**
 * `CreateOrgInviteLink`（shared-invite-links delta，拍板①③）—— 编排。
 *
 * 做的三件事：① 越权判定（只有组织管理员能建链）② 由被授予角色推出「进不进复核」
 * 与「签不签令牌」（`needsDualReview`——与单人邀请**同一条**函数，O-28⑥ 的同一个
 * 判据不写第二份）③ 令牌生成 + hash（明文只在返回值里出现，随响应回传一次后消失）。
 *
 * ⚠ admin 级链接：status = pending-review、令牌**不生成**——两个值一起算出来，
 *   「待复核但令牌存在」在本文件里连表达都表达不出来（同 invite-org-member.ts）。
 * ⚠ expiresAt 只在即建即用时计算：待复核链接的窗口从**批准**起算（契约头注的理由）。
 */
import {
  hashOrgInviteLinkToken,
  needsDualReview,
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
  const pending = needsDualReview(input.orgRole);
  const token = pending ? null : newOrgInviteLinkToken();
  const expiresAt = pending ? null : new Date(now.getTime() + ORG_INVITE_LINK_EXPIRY_MS[input.expiry]);
  const linkId = newOrgInviteLinkId();

  await deps.repo.create({
    linkId,
    orgId: input.orgId,
    actorId: input.actorId,
    orgRole: input.orgRole,
    expiry: input.expiry,
    maxUses: input.maxUses,
    status: pending ? "pending-review" : "active",
    tokenHash: token === null ? null : hashOrgInviteLinkToken(token),
    expiresAt,
  });

  return { linkId, status: pending ? "pending-review" : "active", linkToken: token, expiresAt };
}
