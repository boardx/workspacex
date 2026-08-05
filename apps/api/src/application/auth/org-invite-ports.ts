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
   *
   * `quota-exhausted`（F11 / I-9）同样是**这个仓储自己判的**，不是用例先查一次
   * 「还有没有配额」再插入——那样两步之间有窗口：两名管理员同时看到「还剩 1 个」，
   * 都插入成功，配额变成 -1 且没有任何报错。判定与插入必须在同一次锁定里（见实现）。
   */
  | { readonly ok: false; readonly reason: "duplicate" | "already-member" | "quota-exhausted" };

/* ─────────────────────────── 双人复核（F11 / O-28 ⑥） ─────────────────────────── */

export interface ReviewOrgInviteInput {
  readonly orgId: OrgId;
  readonly inviteId: string;
  readonly reviewerId: string;
  readonly decision: "approve" | "reject";
  readonly now: Date;
  /** `approve` 时签发的新令牌；`reject` 时为 null。由用例（不是仓储）生成，见 review-admin-invite.ts。 */
  readonly token: string | null;
  readonly tokenExpiresAt: Date | null;
}

export type ReviewOrgInviteResult =
  | { readonly ok: true; readonly status: "pending" | "revoked"; readonly tokenIssued: boolean }
  | {
      readonly ok: false;
      /**
       * ⚠ 三种情形三个码，**不合并**：
       *   `not-found`：这个 orgId 下根本没有这条邀请 id。
       *   `self-review`：`reviewerId === invited_by`（I-4），无论当前是什么状态都优先判这条。
       *   `already-decided`：邀请**存在**但已不在 `awaiting-review`——
       *     同一 reviewer 重复同一 decision 是幂等重放（`ok: true` 分支，不到这里）；
       *     到这里的是「别人已经先批/先拒了」或「已被撤销」，映射为 `VERSION_CHANGED`。
       */
      readonly reason: "not-found" | "self-review" | "already-decided";
    };

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

/* ─────────────────── 重发 / 撤销（#363：契约里有、路由上没有） ─────────────────── */

/**
 * `ResendOrgInvite` 的仓储入参。
 *
 * ⚠ **令牌由用例生成、由仓储写入**——与 `ReviewOrgInviteInput` 逐字同一种分工，
 *   理由也一样：签发策略（用哪个生成器、多长有效期）是用例的事，
 *   而「作废旧的」与「写入新的」必须在同一次锁定里才成立（I-6）。
 *
 * ⚠ 限流的两个阈值**当参数传进来**，不在仓储里读 `AUTH_POLICY`。
 *   仓储读策略常量 = 第二处策略声明点，而本仓已五次栽在这上面。
 *   判定本身在仓储里做，因为它必须与写入同一次锁定：先查「冷却过了吗」再写，
 *   两路并发都会看到「过了」，于是一次点击发出两枚令牌、旧的那枚被作废，
 *   而两名管理员各自手上都是一条已经失效的链接。
 */
export interface ResendOrgInviteInput {
  readonly orgId: OrgId;
  readonly inviteId: string;
  readonly now: Date;
  readonly token: string;
  readonly tokenExpiresAt: Date;
  /** `AUTH_POLICY.resendCooldownSeconds`。 */
  readonly cooldownSeconds: number;
  /** `AUTH_POLICY.resendDailyMax`：同一条邀请 24 小时内最多签发几枚令牌。 */
  readonly dailyMax: number;
}

export type ResendOrgInviteResult =
  | { readonly ok: true; readonly newTokenIssued: true; readonly cooldownSec: number }
  | {
      readonly ok: false;
      /**
       * ⚠ 三个码，**不合并**：
       *   `not-found`：本组织下没有这条邀请 id（**跨组织的 id 也落在这里**——
       *     仓储在租户上下文里查，别人组织的那一行由 RLS 读不到，
       *     于是「不存在」与「不是你的」由构造产生同一个结果，不靠调用方记得合并）。
       *   `rate-limited`：冷却未过 或 24h 内已达 `dailyMax`。
       *   `not-resendable`：邀请存在但当前状态不该有链接——
       *     `awaiting-review`（I-3：复核前不签发）/ `revoked` / `used`。
       */
      readonly reason: "not-found" | "rate-limited" | "not-resendable";
    };

/** `RevokeOrgInvite` 的仓储入参。撤销不签发任何东西，所以没有 token 字段。 */
export interface RevokeOrgInviteInput {
  readonly orgId: OrgId;
  readonly inviteId: string;
  readonly actorId: string;
  readonly now: Date;
}

export type RevokeOrgInviteResult =
  | { readonly ok: true; readonly status: "revoked" }
  /**
   * ⚠ `already-used` 与 `not-found` 分开：一条已被激活的邀请**不能**被撤销回去
   * （成员已经建好了，撤销邀请不会把他踢出组织——那是 `removeOrgMember` 的事），
   * 而它与「这条邀请不存在」要调用者做的事完全不同。映射为 `VERSION_CHANGED`，
   * 与 `reviewAdminInvite` 的 `already-decided` 同一处置。
   */
  | { readonly ok: false; readonly reason: "not-found" | "already-used" };

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

  /**
   * F11 / O-28 ⑥：另一名管理员批准或拒绝一条 `awaiting-review` 邀请。
   *
   * 一次事务：锁定该行 → 判自批 → 判状态 → 写 `status` + `reviewed_by/at`（+ approve 时
   * 一并写 `org_invite_tokens`）。与 `create` 同一条理由：判定与写入必须在同一次锁定里，
   * 否则两名管理员同时批只生效一次（I-4 的并发半句）无法保证。
   */
  reviewAdminInvite(input: ReviewOrgInviteInput): Promise<ReviewOrgInviteResult>;

  /**
   * #363 / I-6：**重发 = 签发新令牌 + 作废旧令牌**，不是「把同一条链接再发一次」。
   *
   * 一次事务：锁定邀请行 → 判状态 → 判限流 → 作废旧令牌 → 写新令牌 + `sent_at`。
   * 「作废旧的」不是可选步骤：`org_invite_tokens_live_uniq`（迁移 0022，部分唯一索引
   * `WHERE consumed_at IS NULL`）就是为它建的——漏掉它的表现不是旧链接还能用，
   * 是**新令牌插不进去**，重发直接 23505 失败。
   */
  resendOrgInvite(input: ResendOrgInviteInput): Promise<ResendOrgInviteResult>;

  /**
   * #363：撤销一条尚未被激活的邀请。**幂等**——重复撤销返回同一 `revoked`。
   *
   * 只改 `org_invites.status`，**不动 `org_invite_tokens`**：激活路径第 (3) 步
   * 逐字要求 `status = 'pending'`（见 `pg-org-invite-repository.ts`），
   * 所以状态一翻，手里那枚令牌当场作废，且失败模式与「令牌不存在」逐字节相同（V10）。
   * 再去 consume 一遍令牌不会让任何一条链接更早失效，只会多一处必须与激活路径
   * 保持一致的判断。
   */
  revokeOrgInvite(input: RevokeOrgInviteInput): Promise<RevokeOrgInviteResult>;
}

export const ORG_INVITE_REPOSITORY = Symbol("OrgInviteRepository");
