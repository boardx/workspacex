/**
 * `ActivateOrgMember` (F10 / UC-1.6) —— 受邀人点开激活链接，成为组织成员。
 *
 * ## 本用例最大的越权面，以及它被挡在哪一层
 *
 * usecases.md：「请求里携带的 orgId / orgRole / teamId **一律忽略**，
 * 实际授予恒为服务端记录值（I-2）」。这句话有三处落点，缺一处就形同虚设：
 *
 *   ① 契约面   `activateOrgMember.in` 里**根本没有**这三个字段
 *             （「忽略一个字段」是实现纪律，会被忘；「字段不存在」是契约事实）。
 *   ② 用例面   本文件把声明值命名为 `untrustedClaims` 并且**只**交给留痕，
 *             不参与任何一次赋值。
 *   ③ 仓储面   授予值在事务内从 `org_invites` 那一行 SELECT 出来。
 *             这一层才是真正的那一层——前两层都拦不住「有人在仓储里把
 *             INSERT 的第三个参数换成入参」。
 *             `tests/auth/activation-link-tamper-server-authoritative.test.ts`
 *             的反证正是拆掉 ③，断言当场变红。
 *
 * ## 口令策略复用 phase-00，不另写一份
 *
 * `AUTH_POLICY.passwordMinLen` + 弱口令库（O-28 ①）。本文件调用的是与注册**同一个**
 * `domain/auth/password-policy.checkPassword`，不是一份「长度也检查一下」的复制品——
 * 第二份的漂移方向永远是「有人调严了注册那条，激活这条纹丝不动」，
 * 于是组织里最新加入的人反而口令最弱。
 *
 * ## 会话
 *
 * 契约 `out.sessionId` 非空：激活成功即登录（O-28 ⑤——点击一次性激活链接即足以证明
 * 邮箱所有权，不再二次发信）。所以新账号在这条路径上是 **已验证** 的，
 * 与 `registerWithInvite` 造出的未验证账号不同；那不是不一致，是两条路径证明力不同。
 */
import type { PasswordHasher, SessionTokenStore, TokenFactory } from "./ports";
import type { OrgInviteRepository } from "./org-invite-ports";
import type { UntrustedLinkClaims } from "../../domain/auth/org-invite";
import { checkPassword } from "../../domain/auth/password-policy";
import { newUserId } from "../../domain/auth/registration";
import { SESSION_TTL_MS, type SessionRecord } from "../../domain/auth/session-lifetime";
import { PasswordPolicyError } from "./errors";
import { OrgAdminError } from "./org-invite-errors";

export interface ActivateOrgMemberDeps {
  readonly repo: OrgInviteRepository;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionTokenStore;
  /** 会话 id 工厂。与登录路径同一个端口——两份 id 生成器就是两种可猜测性。 */
  readonly tokens: TokenFactory;
  readonly now?: () => Date;
}

export interface ActivateOrgMemberInput {
  readonly token: string;
  readonly mode: "new-account" | "existing-account";
  /** 仅 `new-account`。⚠ 没有 email：邮箱取自邀请行。 */
  readonly profile: { readonly name: string; readonly password: string } | null;
  /** 仅 `existing-account`：Guard 已认证过的 userId。 */
  readonly existingUserId: string | null;
  /**
   * 链接查询串里带来的声明值。**对授予没有任何影响**，只用于安全留痕。
   * 调用方没带就传三个 null。
   */
  readonly untrustedClaims: UntrustedLinkClaims;
}

export interface ActivateOrgMemberOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly orgRole: string;
  readonly teamId: string | null;
  readonly sessionId: string;
  /** 便于接口层记日志；不进响应体。 */
  readonly tamperRecorded: boolean;
}

export async function activateOrgMember(
  deps: ActivateOrgMemberDeps,
  input: ActivateOrgMemberInput,
): Promise<ActivateOrgMemberOutput> {
  const now = (deps.now ?? (() => new Date()))();

  // 两个分支的入参是互斥的，且**在拿令牌去查库之前**就判掉。
  // 反过来（先查库再判形状）会让一个畸形请求也变成一次令牌探测。
  if (input.mode === "new-account") {
    if (input.profile === null) throw new OrgAdminError("INVITE_NOT_FOUND");
  } else if (input.existingUserId === null) {
    throw new OrgAdminError("INVITE_NOT_FOUND");
  }

  // 口令哈希在事务之外算（与 `registerWithInvite` 同一条理由：bcrypt cost-12 是
  // 几百毫秒，放进事务就是把邀请行的锁按住那么久，并发激活时逐个串行）。
  let newAccount: { userId: string; displayName: string; passwordHash: string } | null = null;
  if (input.mode === "new-account" && input.profile !== null) {
    // 与注册同一个 `checkPassword`（O-28 ①），不是一份「长度也检查一下」的复制品。
    const rejection = checkPassword(input.profile.password);
    if (rejection !== null) throw new PasswordPolicyError(rejection);
    newAccount = {
      userId: newUserId(),
      displayName: input.profile.name,
      passwordHash: await deps.hasher.hash(input.profile.password),
    };
  }

  const result = await deps.repo.activate({
    token: input.token,
    now,
    newAccount,
    existingUserId: input.mode === "existing-account" ? input.existingUserId : null,
    // 一路传到仓储，一路只进审计表。它在这条链上出现三次，三次都叫这个名字。
    untrustedClaims: input.untrustedClaims,
  });

  if (!result.ok) {
    // ⚠ 四种失效一个码（V10）。`already-member` 是另一回事：它要引导用户去登录，
    // 而且它不泄露任何「这个组织存在吗」之外的信息——调用者手里本来就有一枚有效令牌。
    throw new OrgAdminError(
      result.reason === "already-member" ? "INVITE_ALREADY_MEMBER" : "INVITE_NOT_FOUND",
    );
  }

  const grant = result.grant;

  // 会话在事务**之后**签发，而不是之中。
  //
  // 会话存在 Redis，事务在 PostgreSQL：把它放进事务里既做不到原子，
  // 又会让「Redis 挂了」变成「成员没建成」。这里的失败模式是「成员建好了但没拿到会话」，
  // 用户重新登录一次即可，且 `org_memberships` 里已经有他——这是两种残缺里可恢复的那一种。
  const record: SessionRecord = {
    id: deps.tokens.sessionId(),
    userId: grant.userId,
    currentOrgId: grant.orgId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_MS,
    revokedAt: null,
  };
  await deps.sessions.issue(record);

  return {
    userId: grant.userId,
    // ⚠ 逐字回传服务端记录值。这四个字段没有一个来自 `input`。
    orgId: grant.orgId,
    orgRole: grant.orgRole,
    teamId: grant.teamId,
    sessionId: record.id,
    tamperRecorded: grant.tamperRecorded,
  };
}
