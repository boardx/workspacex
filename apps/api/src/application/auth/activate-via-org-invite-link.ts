/**
 * `ActivateViaOrgInviteLink`（shared-invite-links delta）—— 持链接者自助加入。
 *
 * 与 `activateOrgMember` 的三处刻意差异：
 *   ① 邮箱**自填**（共享链接不指向任何邮箱），由本文件 `normalizeEmail` 后交仓储查重
 *     ——已有账号 → `INVITE_ALREADY_MEMBER`（拍板①明确拒绝、不重复建号，OA12②）。
 *   ② 只有建新号一条分支：existing-account 加入不在本 delta 范围（OA12②）。
 *   ③ 令牌先 hash 再交仓储——仓储与库都**不见明文**（delta 对照表）。
 *
 * 相同的纪律原样保留：口令策略复用 phase-00 同一个 `checkPassword`；哈希在事务外算
 * （bcrypt cost-12 不进锁）；会话在事务之后签发（Redis 挂了 ⇒ 成员建好但没会话，
 * 重新登录可恢复——两种残缺里可恢复的那一种）。
 */
import type { PasswordHasher, SessionTokenStore, TokenFactory } from "./ports";
import type { OrgInviteLinkRepository } from "./org-invite-link-ports";
import { hashOrgInviteLinkToken } from "../../domain/auth/org-invite-link";
import { checkPassword } from "../../domain/auth/password-policy";
import { newUserId, normalizeEmail } from "../../domain/auth/registration";
import { SESSION_TTL_MS, type SessionRecord } from "../../domain/auth/session-lifetime";
import { UNKNOWN_DEVICE } from "../../domain/auth/device-fingerprint";
import { PasswordPolicyError } from "./errors";
import { OrgAdminError } from "./org-invite-errors";

export interface ActivateViaOrgInviteLinkDeps {
  readonly repo: OrgInviteLinkRepository;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionTokenStore;
  readonly tokens: TokenFactory;
  readonly now?: () => Date;
}

export interface ActivateViaOrgInviteLinkInput {
  readonly token: string;
  readonly email: string;
  readonly profile: { readonly name: string; readonly password: string };
}

export interface ActivateViaOrgInviteLinkOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly orgRole: string;
  readonly sessionId: string;
}

export async function activateViaOrgInviteLink(
  deps: ActivateViaOrgInviteLinkDeps,
  input: ActivateViaOrgInviteLinkInput,
): Promise<ActivateViaOrgInviteLinkOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const rejection = checkPassword(input.profile.password);
  if (rejection !== null) throw new PasswordPolicyError(rejection);

  const result = await deps.repo.activate({
    tokenHash: hashOrgInviteLinkToken(input.token),
    now,
    email: normalizeEmail(input.email),
    newAccount: {
      userId: newUserId(),
      displayName: input.profile.name,
      passwordHash: await deps.hasher.hash(input.profile.password),
    },
  });

  if (!result.ok) {
    // 五种失效一个码（V10）；配额与邮箱查重是令牌校验**之后**的明确拒绝（契约头注）。
    if (result.reason === "already-member") throw new OrgAdminError("INVITE_ALREADY_MEMBER");
    if (result.reason === "quota-exhausted") throw new OrgAdminError("QUOTA_EXHAUSTED");
    throw new OrgAdminError("INVITE_NOT_FOUND");
  }

  const grant = result.grant;
  const record: SessionRecord = {
    id: deps.tokens.sessionId(),
    userId: grant.userId,
    currentOrgId: grant.orgId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_MS,
    revokedAt: null,
    // 同 activate-org-member.ts 的 F03 说明：这条路径没有采集设备上下文，如实兜底。
    device: UNKNOWN_DEVICE,
    location: null,
    lastActiveAt: now.getTime(),
  };
  await deps.sessions.issue(record);

  return { userId: grant.userId, orgId: grant.orgId, orgRole: grant.orgRole, sessionId: record.id };
}
