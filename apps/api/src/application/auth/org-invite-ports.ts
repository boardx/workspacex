/**
 * `OrgInviteRepository` —— F10（UC-1.6）的唯一持久化端口。
 *
 * ## 为什么激活是**一个方法**而不是四个
 *
 * usecases.md `ActivateOrgMember`：「部分成功**禁止** —— 核销令牌、创建 org_member、
 * 写角色与团队、初始化配额必须在**同一事务**内完成（I-1）」。
 * 事务是这个方法的性质：任意两步之间的方法边界，都是将来某次重构可以放一个 commit 的地方。
 * 与 `RegistrationRepository.redeemAndCreateOrg` 同一条理由（见 ports.ts）。
 *
 * ## 为什么 `activate` 收下 `untrustedClaims`
 *
 * 它对授予**没有任何影响**——授予恒取自事务内读到的 `org_invites` 行（I-2）。
 * 它在这里，是因为 usecases.md 还要求「篡改尝试写安全审计」：不收下声明值，
 * 「篡改无效」就只能证明到「我们没读」，证明不到「有人试过」。
 *
 * ⚠ 参数名是防线的一部分。叫 `claims` 或 `linkParams` 的东西会被下一个人拿去用；
 * 叫 `untrustedClaims` 的东西被拿去用时，那一行 diff 自己会喊。
 */
import type { UntrustedLinkClaims } from "../../domain/auth/org-invite";
import type { OrgId } from "../../domain/org-id";

/* ─────────────────────────── 邀请 ─────────────────────────── */

export interface CreateOrgInviteInput {
  readonly inviteId: string;
  readonly orgId: OrgId;
  readonly actorId: string;
  /** 已由调用方规范化（`normalizeEmail`）。 */
  readonly email: string;
  readonly orgRole: string;
  readonly teamId: string | null;
  /** `pending` | `awaiting-review`，由 `initialInviteStatus` 推出，仓储不再判一次。 */
  readonly status: "pending" | "awaiting-review";
  /**
   * `null` ⟺ `status = "awaiting-review"`（I-3：双人复核前不签发）。
   * 两者的一致性由**调用方**保证并由迁移里的 CHECK 兜底，仓储不做第二次判断——
   * 第二次判断意味着两处规则，而漏掉的那一处会在复核前把链接发出去。
   */
  readonly token: string | null;
  readonly tokenExpiresAt: Date | null;
}

export type CreateOrgInviteResult =
  | { readonly ok: true; readonly inviteId: string; readonly tokenIssued: boolean; readonly replayed: boolean }
  /**
   * ⚠ `duplicate` 与 `already-member` 分开，因为 usecases.md 把它们分成两个码，
   * 而它们要用户做的事不同：一个是「别重复邀」，一个是「让他直接登录」。
   */
  | { readonly ok: false; readonly reason: "duplicate" | "already-member" };

/* ─────────────────────────── 激活 ─────────────────────────── */

export interface ActivateOrgInviteInput {
  readonly token: string;
  readonly now: Date;
  /**
   * 新账号分支。⚠ 这里**没有 email**：邮箱取自邀请行（I-2 的同一条理由——
   * 允许调用方带邮箱，就等于允许持有令牌的人把邀请落到别的地址上）。
   */
  readonly newAccount: {
    readonly userId: string;
    readonly displayName: string;
    readonly passwordHash: string;
  } | null;
  /** 已有账号分支：Guard 已认证过的 userId。 */
  readonly existingUserId: string | null;
  /** 见文件头。对授予无影响，只用于留痕。 */
  readonly untrustedClaims: UntrustedLinkClaims;
}

export interface ActivateOrgInviteGrant {
  readonly userId: string;
  readonly orgId: OrgId;
  /** 服务端记录值。**恒**来自 `org_invites` 那一行。 */
  readonly orgRole: string;
  readonly teamId: string | null;
  /** 声明值与记录值对不上，且已写入 `org_invite_tamper_attempts`。 */
  readonly tamperRecorded: boolean;
}

export type ActivateOrgInviteResult =
  | { readonly ok: true; readonly grant: ActivateOrgInviteGrant }
  /**
   * ⚠ `not-found` 覆盖**四种**情形：令牌不存在 / 已过期 / 已核销 / 邀请已撤销。
   * 分开就是把「这个组织存在吗」做成一个探测器（V10）。与 `InviteCodeInvalidError`
   * 同一条理由，同一种取舍。
   */
  | { readonly ok: false; readonly reason: "not-found" | "already-member" };

export interface OrgInviteRepository {
  /**
   * ⚠ 幂等的判据是 **(orgId, email, orgRole, teamId) 四元组相同**，不是二元组。
   *
   * usecases.md 同时要求「同 (orgId, email) 的重复提交返回既有 inviteId」与
   * 「并发两名管理员同时邀同一邮箱，恰好一条成功，第二路收 `INVITE_DUPLICATE`」。
   * 二元组判据下这两条互相矛盾：两名管理员分别邀「顾问」和「管理员」时，
   * 第二路会拿到第一路的 inviteId 并以为自己邀成了管理员。
   * ⇒ 四元组相同 = 重放（返回既有行）；只有邮箱相同 = 冲突（`duplicate`）。
   * 这是一次**裁定**，不是抄来的，记在这里而不是留给下一个人重新猜。
   */
  create(input: CreateOrgInviteInput): Promise<CreateOrgInviteResult>;

  /** 一次事务：核销令牌 → 读服务端记录 → 建成员 → 标 used（+ 篡改留痕）。 */
  activate(input: ActivateOrgInviteInput): Promise<ActivateOrgInviteResult>;
}

export const ORG_INVITE_REPOSITORY = Symbol("OrgInviteRepository");
