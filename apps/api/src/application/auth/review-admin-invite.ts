/**
 * `ReviewAdminInvite`（F11 / O-28 ⑥）—— 编排。不知道 HTTP，不知道 PostgreSQL。
 *
 * 做的两件事：① 越权判定（只有管理员能批）② 令牌的生成/不生成——approve 时新签一枚
 * （与初次邀请**同一个**生成器、同一个有效期常量，见 `domain/auth/org-invite.ts`），
 * reject 时不生成。「谁能批」「批完什么状态」这两条判断都不在这里——前者是
 * `isSelfReview` 那条纯函数，后者是仓储那次锁定里做的（判定与写入必须同一次锁定，
 * 理由见 `org-invite-ports.ts` 的 `ReviewOrgInviteInput` 注释）。
 */
import { newOrgInviteToken, ORG_INVITE_REVIEW_TOKEN_VALIDITY_MS } from "../../domain/auth/org-invite";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgInviteRepository } from "./org-invite-ports";

export interface ReviewAdminInviteDeps {
  readonly repo: OrgInviteRepository;
  readonly now?: () => Date;
}

export interface ReviewAdminInviteInput {
  readonly orgId: OrgId;
  /** 已由 Guard 认证过的调用者。绝不从请求体取——那是「谁批的」这条断言的唯一来源。 */
  readonly reviewerId: string;
  readonly reviewerOrgRole: string;
  readonly inviteId: string;
  readonly decision: "approve" | "reject";
}

export interface ReviewAdminInviteOutput {
  readonly status: "pending" | "revoked";
  /**
   * ⚠ 恒为 false 当 `decision = "reject"`；首次 `approve` 为 true（I-3 的正面：批准后必发）；
   *   幂等重放（重复 approve，仓储 `replayed` 分支）为 false——这次调用没有再签一次。
   */
  readonly tokenIssued: boolean;
  /**
   * 一次性激活令牌明文（coord-main 2026-08-11 D2 裁决 A）：仅当**这次调用真的签发了**
   * （`tokenIssued = true`）才非空——reject / 幂等重放拿不到，语义与
   * `inviteOrgMember` / `resendOrgInvite` 的 activationToken 完全一致。
   */
  readonly activationToken: string | null;
}

export async function reviewAdminInvite(
  deps: ReviewAdminInviteDeps,
  input: ReviewAdminInviteInput,
): Promise<ReviewAdminInviteOutput> {
  // 只有管理员能批——与 `InviteOrgMember` 判的是同一层身份（组织角色），不是项目角色。
  if (input.reviewerOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();
  const approve = input.decision === "approve";
  const token = approve ? newOrgInviteToken() : null;
  const tokenExpiresAt = approve ? new Date(now.getTime() + ORG_INVITE_REVIEW_TOKEN_VALIDITY_MS) : null;

  const result = await deps.repo.reviewAdminInvite({
    orgId: input.orgId,
    inviteId: input.inviteId,
    reviewerId: input.reviewerId,
    decision: input.decision,
    now,
    token,
    tokenExpiresAt,
  });

  if (!result.ok) {
    if (result.reason === "self-review") throw new OrgAdminError("INVITE_SELF_REVIEW_FORBIDDEN");
    if (result.reason === "not-found") throw new OrgAdminError("INVITE_NOT_FOUND");
    // `already-decided`：邀请存在但已经不在 awaiting-review——另一名管理员先批/先拒了，
    // 或它已被撤销。「只生效一次」的第二路收到的是**这个**，不是 INVITE_NOT_FOUND：
    // 邀请仍然存在，只是状态已经翻过去了。
    throw new OrgAdminError("VERSION_CHANGED");
  }

  // token 只在真的写进库的那一次（tokenIssued）回传——重放分支 tokenIssued=false，
  // 这里生成的 token 没有落库，绝不能把它当成有效链接吐出去。
  return { status: result.status, tokenIssued: result.tokenIssued, activationToken: result.tokenIssued ? token : null };
}
