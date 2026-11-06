import { issueInvitationSession } from "./issue-invitation-session";
import type { LoginOutput } from "./login";
/** Shared invitation joins support both new accounts and authenticated existing users.
 * Role comes from the stored link; membership/use-count updates are atomic.
 * Existing user identity is supplied by the guarded accept route, never the body.
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

export type ActivateViaOrgInviteLinkInput = {
  readonly token: string;
  readonly email: string;
  readonly profile: { readonly name: string; readonly password: string };
  readonly existingUserId?: never;
} | {
  readonly token: string;
  /** From authenticated principal, never request body. */
  readonly existingUserId: string;
  readonly email?: never;
  readonly profile?: never;
};

export interface ActivateViaOrgInviteLinkOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly orgRole: string;
  readonly sessionId: string;
  readonly session: LoginOutput;
}

export async function activateViaOrgInviteLink(
  deps: ActivateViaOrgInviteLinkDeps,
  input: ActivateViaOrgInviteLinkInput,
): Promise<ActivateViaOrgInviteLinkOutput> {
  const now = (deps.now ?? (() => new Date()))();

  let account: {userId:string;displayName:string;passwordHash:string} | null = null;
  if (!input.existingUserId) {
    if (!input.profile) throw new OrgAdminError("INVITE_NOT_FOUND");
    const rejection = checkPassword(input.profile.password);
    if (rejection !== null) throw new PasswordPolicyError(rejection);
    account = {userId:newUserId(),displayName:input.profile.name,passwordHash:await deps.hasher.hash(input.profile.password)};
  }
  const result = await deps.repo.activate({
    tokenHash: hashOrgInviteLinkToken(input.token), now,
    email: input.email ? normalizeEmail(input.email) : "",
    newAccount: account,
    ...(input.existingUserId ? {existingUserId:input.existingUserId} : {}),
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
  const session = await issueInvitationSession(deps.sessions, record);

  return { userId: grant.userId, orgId: grant.orgId, orgRole: grant.orgRole, sessionId: record.id, session };
}
