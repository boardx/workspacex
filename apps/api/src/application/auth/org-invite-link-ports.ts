/**
 * `OrgInviteLinkRepository` —— 组织共享邀请链接（shared-invite-links delta）的唯一持久化端口。
 *
 * 与 `OrgInviteRepository`（单人邀请）分开：两套令牌语义刻意不同（一次性明文 vs
 * 多次 hash），塞进同一个端口会诱导「复用一下 consume」——而共享链接恰恰**没有**
 * consume（它不核销，只计数）。
 *
 * ## 为什么 `activate` 是一个方法而不是五个
 *
 * 校验令牌 → 判过期/上限 → 判配额 → 建号 → 建成员 → `used_count` +1，六步一个事务
 * （I-1 同款）：任意两步之间的方法边界都是将来某次重构可以放 commit 的地方。
 * 失败一律回滚 ⇒ 计数与配额都不变（verification.md 的配额反证断言的就是这一条）。
 */
import type { OrgId } from "../../domain/org-id";
import type { DerivedLinkStatus, OrgInviteLinkExpiryKind, StoredLinkStatus } from "../../domain/auth/org-invite-link";

/* ─────────────────────────── 建链 ─────────────────────────── */

export interface CreateOrgInviteLinkInput {
  readonly linkId: string;
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly orgRole: string;
  readonly expiry: OrgInviteLinkExpiryKind;
  readonly maxUses: number | null;
  /** `pending` ⟺ admin 级（拍板③）。由用例经 `needsDualReview` 推出，仓储不再判一次。 */
  readonly status: StoredLinkStatus;
  /** `null` ⟺ `status = "pending-review"`（令牌不存在，同 I-3 的落地形状）。 */
  readonly tokenHash: string | null;
  readonly expiresAt: Date | null;
}

/* ─────────────────────────── 列表 ─────────────────────────── */

export interface OrgInviteLinkRow {
  readonly linkId: string;
  readonly orgRole: string;
  /** 已按 `deriveOrgInviteLinkStatus` 派生的五态。 */
  readonly status: DerivedLinkStatus;
  readonly expiry: OrgInviteLinkExpiryKind;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly usedCount: number;
  readonly createdBy: string;
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

/* ─────────────────────────── 作废 ─────────────────────────── */

export interface RevokeOrgInviteLinkInput {
  readonly orgId: OrgId;
  readonly linkId: string;
  readonly now: Date;
}

export type RevokeOrgInviteLinkResult =
  | { readonly ok: true; readonly status: "revoked" }
  | { readonly ok: false; readonly reason: "not-found" };

/* ─────────────────────────── 复核（拍板③） ─────────────────────────── */

export interface ReviewOrgInviteLinkInput {
  readonly orgId: OrgId;
  readonly linkId: string;
  readonly reviewerId: string;
  readonly decision: "approve" | "reject";
  readonly now: Date;
  /** `approve` 时签发的新令牌 hash；`reject` 时为 null。由用例生成（同 review-admin-invite 的分工）。 */
  readonly tokenHash: string | null;
  readonly expiresAt: Date | null;
}

export type ReviewOrgInviteLinkResult =
  | { readonly ok: true; readonly status: "active" | "revoked"; readonly tokenIssued: boolean; readonly expiresAt: Date | null }
  | {
      /** 三码不合并——与 `ReviewOrgInviteResult` 逐字同一处置。 */
      readonly ok: false;
      readonly reason: "not-found" | "self-review" | "already-decided";
    };

/* ─────────────────────────── 激活（匿名） ─────────────────────────── */

export interface ActivateViaOrgInviteLinkInput {
  /** 已由用例 hash 过——仓储只见 hash，明文不进这个端口。 */
  readonly tokenHash: string;
  readonly now: Date;
  /** 邮箱已由用例规范化（`normalizeEmail`）。 */
  readonly email: string;
  readonly newAccount: {
    readonly userId: string;
    readonly displayName: string;
    readonly passwordHash: string;
  };
}

export interface OrgInviteLinkGrant {
  readonly userId: string;
  readonly orgId: OrgId;
  /** 服务端记录值。**恒**来自 `org_invite_links` 那一行（I-2 同款）。 */
  readonly orgRole: string;
}

export type ActivateViaOrgInviteLinkResult =
  | { readonly ok: true; readonly grant: OrgInviteLinkGrant }
  /**
   * ⚠ `not-found` 覆盖**五种**情形：hash 不存在 / 链接已作废 / 已过期 / 已用满 /
   * 待复核（后者在库里表现为 hash 行不存在）。分开就是把「这个组织的链接现在
   * 什么状态」做成一个探测器（V10）。`already-member` = 邮箱已有账号（无论是否
   * 本组织成员，OA12②）；`quota-exhausted` = 席位配额满（拍板①「文案指向配额」）。
   */
  | { readonly ok: false; readonly reason: "not-found" | "already-member" | "quota-exhausted" };

export interface OrgInviteLinkRepository {
  create(input: CreateOrgInviteLinkInput): Promise<void>;

  /** 仅 admin 调用（用例判）。恒不含令牌——明文在库里不存在，hash 不出仓储。 */
  list(orgId: OrgId, now: Date): Promise<OrgInviteLinkRow[]>;

  /** 幂等：已 revoked 返回同一状态，不刷新 revoked_at。 */
  revoke(input: RevokeOrgInviteLinkInput): Promise<RevokeOrgInviteLinkResult>;

  /**
   * 一次事务：锁定链接行 → 判自批 → 判待复核态 → 写状态（approve 一并写 token hash
   * 与 expires_at——窗口从批准起算）。判定与写入同一次锁定（`reviewAdminInvite` 同款）。
   */
  review(input: ReviewOrgInviteLinkInput): Promise<ReviewOrgInviteLinkResult>;

  /**
   * 一次事务：按 hash 找链接（无租户上下文）→ 切租户 → 锁定链接行判状态/过期/上限
   * → 锁定组织行数座位判配额 → 建号 → 建成员 → `used_count` +1。
   * 任何一步失败全回滚——`used_count` 与配额都不变。
   */
  activate(input: ActivateViaOrgInviteLinkInput): Promise<ActivateViaOrgInviteLinkResult>;
}

export const ORG_INVITE_LINK_REPOSITORY = Symbol("OrgInviteLinkRepository");
