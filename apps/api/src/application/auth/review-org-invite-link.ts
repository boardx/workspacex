/**
 * `ReviewOrgInviteLink`（拍板③ / O-28⑥ 适用点扩展）—— 编排。
 *
 * 与 `reviewAdminInvite` 逐字同一分工：越权判定 + 令牌生成在这里，「谁能批」
 * （`isSelfReview`——同一条函数）与「批完什么状态」在仓储那次锁定里。
 * approve 即签发：令牌在批准那一刻才产生，明文只回传给批准人这一次；
 * 有效期窗口从批准起算（`ORG_INVITE_LINK_EXPIRY_MS[link.expiry]`，仓储读行内档位）。
 */
import {
  hashOrgInviteLinkToken,
  newOrgInviteLinkToken,
} from "../../domain/auth/org-invite-link";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteLinkRepository } from "./org-invite-link-ports";

export interface ReviewOrgInviteLinkDeps {
  readonly repo: OrgInviteLinkRepository;
  readonly now?: () => Date;
}

export interface ReviewOrgInviteLinkInput {
  readonly orgId: OrgId;
  readonly reviewerId: string;
  readonly reviewerOrgRole: string;
  readonly linkId: string;
  readonly decision: "approve" | "reject";
}

export interface ReviewOrgInviteLinkOutput {
  readonly status: "active" | "revoked";
  /** 只在真的签发的这一次非空（reject / 幂等重放为 null）。 */
  readonly linkToken: string | null;
  readonly expiresAt: Date | null;
}

export async function reviewOrgInviteLink(
  deps: ReviewOrgInviteLinkDeps,
  input: ReviewOrgInviteLinkInput,
): Promise<ReviewOrgInviteLinkOutput> {
  if (input.reviewerOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();
  const approve = input.decision === "approve";
  // ⚠ expiresAt 在仓储里算：窗口时长取决于**链接行里存的档位**（1d/7d/30d），
  //   而那一行要在锁里才读得到。这里只负责把令牌造出来。
  const token = approve ? newOrgInviteLinkToken() : null;

  const result = await deps.repo.review({
    orgId: input.orgId,
    linkId: input.linkId,
    reviewerId: input.reviewerId,
    decision: input.decision,
    now,
    tokenHash: token === null ? null : hashOrgInviteLinkToken(token),
    expiresAt: null, // 仓储按行内档位自算；这个字段留给「将来允许批准时改档」的扩展位。
  });

  if (!result.ok) {
    if (result.reason === "self-review") throw new OrgAdminError("INVITE_SELF_REVIEW_FORBIDDEN");
    if (result.reason === "not-found") throw new OrgAdminError("INVITE_NOT_FOUND");
    throw new OrgAdminError("VERSION_CHANGED");
  }

  // 明文只在真的落库签发的那一次回传（review-admin-invite.ts 的同一半句）。
  return {
    status: result.status,
    linkToken: result.tokenIssued ? token : null,
    expiresAt: result.expiresAt,
  };
}
