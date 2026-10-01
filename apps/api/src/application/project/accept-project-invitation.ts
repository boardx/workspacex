/**
 * 通用项目邀请（#4787）· 受邀人一侧的三个用例：预览 / 已登录接受 / 匿名激活（全新用户）。
 *
 * ## 授予组织成员资格的只有两处（其余入口的组织成员门一律不放宽）
 *
 *   ① `activateProjectInvitation`  全新用户（没有账号、不在组织里）：建账号 + 组织成员 + 项目 collaborator
 *   ② `acceptProjectInvitation`    已登录、但还不是项目所在组织成员的用户：组织成员 + 项目 collaborator
 *
 * 两处授予的组织角色都是 `INVITED_ORG_ROLE`（`consultant`：四种组织角色里没有任何管理职能的一档——
 * `admin` 管全组织、`lead` 能创建 / 管理项目、`compliance` 能进审计链与合规运营入口，都比它多）。
 * 项目角色恒为 `collaborator`。两个值都不来自请求。`addNonWorkshopMember` / `acceptProjectInvite`
 * 的「目标必须已是组织成员」门没有动。
 *
 * ## 复用 `activateOrgMember` 的账号创建与入会内部件，不另造一套注册
 *
 * 口令策略（同一个 `checkPassword`）、用户 id（`newUserId`）、慢哈希在事务之外算、会话在事务**之后**签发
 * （`issueInvitationSession`，Redis 挂了 ⇒ 账号与成员已建好但没拿到会话，重新登录即可恢复——两种残缺里
 * 可恢复的那一种）。`credentials` / `org_memberships` 的两条 INSERT 在仓储里（组织邀请那两条是内联在它的
 * 仓储里、没有可复用的函数，这里按同一组列写同样的两条）。
 *
 * ## 邮箱验证
 *
 *   · 邮箱邀请：令牌经邮件到达 ⇒ 邮箱所有权已证明 ⇒ 账号直接是已验证的，立即返回会话。
 *   · 链接邀请：邮箱由受邀人自填，**没有**所有权证明 ⇒ 走既有的邮箱验证流程（未验证账号不能登录，
 *     `login.ts` 的 `EMAIL_NOT_VERIFIED`），验证邮件在同一事务里入队，**不返回会话**。
 *
 * ## 失效只有一种说法
 *
 * 令牌不存在 / 过期 / 撤销 / 已用 / 被取代 ⇒ `INVITATION_INVALID`（预览是 `valid: false`），不区分。
 */
import { projectInvitation as C } from "@repo/contracts";
import type { z } from "zod";
import { checkPassword } from "../../domain/auth/password-policy";
import { newUserId } from "../../domain/auth/registration";
import { EMAIL_VERIFICATION_TTL_MS } from "../../domain/auth/email-verification";
import { UNKNOWN_DEVICE } from "../../domain/auth/device-fingerprint";
import { SESSION_TTL_MS, type SessionRecord } from "../../domain/auth/session-lifetime";
import {
  INVITED_ORG_ROLE,
  hashInvitationToken,
  isPlausibleEmail,
  normalizeInviteEmail,
} from "../../domain/project/project-invitation";
import type { EmailVerificationTokenCodec } from "../auth/email-verification-ports";
import { PasswordPolicyError } from "../auth/errors";
import { issueInvitationSession } from "../auth/issue-invitation-session";
import type { PasswordHasher, SessionTokenStore, TokenFactory } from "../auth/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { ProjectInvitationError } from "./project-invitation-errors";
import type { ProjectInvitationRepository } from "./project-invitation-ports";

type PreviewOut = z.infer<typeof C.operations.previewProjectInvitation.out>;
type AcceptOut = z.infer<typeof C.operations.acceptProjectInvitation.out>;
type ActivateOut = z.infer<typeof C.operations.activateProjectInvitation.out>;

const clock = (deps: { now?: () => Date }) => (deps.now ?? (() => new Date()))();

/* ───────────────────────── 预览（匿名可调） ───────────────────────── */

export interface PreviewProjectInvitationDeps {
  readonly invitations: ProjectInvitationRepository;
  readonly now?: () => Date;
}

export async function previewProjectInvitation(
  deps: PreviewProjectInvitationDeps,
  input: { readonly token: string; /** 带会话时的登录用户；匿名为 null。 */ readonly viewerUserId: string | null },
): Promise<PreviewOut> {
  const invalid: PreviewOut = { valid: false, kind: null, projectName: null, inviterName: null, invitedEmail: null, nextStep: null };
  const found = await deps.invitations.lookup(hashInvitationToken(input.token), clock(deps), input.viewerUserId);
  if (!found.valid || found.kind === null) return invalid;

  let nextStep: NonNullable<PreviewOut["nextStep"]>;
  if (input.viewerUserId !== null) {
    const mismatch =
      found.kind === "email" &&
      (found.viewerEmail === null || normalizeInviteEmail(found.viewerEmail) !== found.invitedEmail);
    nextStep = mismatch ? "email_mismatch" : found.viewerIsProjectMember ? "already_member" : "accept";
  } else if (found.kind === "email") {
    nextStep = found.invitedEmailHasAccount ? "login" : "register";
  } else {
    nextStep = "login_or_register";
  }
  return {
    valid: true,
    kind: found.kind,
    projectName: found.projectName,
    inviterName: found.inviterName,
    invitedEmail: found.kind === "email" ? found.invitedEmail : null,
    nextStep,
  };
}

/* ───────────────────────── 已登录接受 ───────────────────────── */

export interface AcceptProjectInvitationDeps {
  readonly invitations: ProjectInvitationRepository;
  readonly provenance?: ProvenanceWriter;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
  readonly now?: () => Date;
}

/** 审计：尽力而为。加入已经提交，审计写失败只记日志，不把一次成功的加入变成失败。 */
async function auditJoin(
  deps: { provenance?: ProvenanceWriter; log?: (m: string, d: Record<string, unknown>) => void },
  input: { orgId: string; projectId: string; userId: string; joinedOrg: boolean },
): Promise<void> {
  if (deps.provenance === undefined) return;
  try {
    const orgId = input.orgId as Parameters<ProvenanceWriter["append"]>[0]["orgId"];
    if (input.joinedOrg) {
      await deps.provenance.append({
        orgId,
        type: "role-changed",
        actorId: input.userId,
        target: { kind: "membership", id: `${input.orgId}:${input.userId}` },
        detail: { op: "org-member-joined-via-project-invitation", orgRole: INVITED_ORG_ROLE, projectId: input.projectId },
      });
    }
    await deps.provenance.append({
      orgId,
      type: "role-changed",
      actorId: input.userId,
      target: { kind: "membership", id: `${input.projectId}:${input.userId}` },
      detail: { op: "project-invitation-accepted", containerKind: "general", role: "collaborator" },
    });
  } catch (err) {
    deps.log?.("project invitation audit failed", { projectId: input.projectId, err });
  }
}

export async function acceptProjectInvitation(
  deps: AcceptProjectInvitationDeps,
  input: { readonly token: string; readonly userId: string },
): Promise<AcceptOut> {
  const out = await deps.invitations.acceptLoggedIn({
    tokenHash: hashInvitationToken(input.token),
    now: clock(deps),
    userId: input.userId,
  });
  if (!out.ok) {
    switch (out.reason) {
      case "invalid":
        throw new ProjectInvitationError("INVITATION_INVALID");
      case "email-mismatch":
        throw new ProjectInvitationError("INVITATION_EMAIL_MISMATCH");
      case "archived":
        throw new ProjectInvitationError("PROJECT_ARCHIVED");
      case "quota":
        throw new ProjectInvitationError("SEAT_QUOTA_EXHAUSTED");
    }
  }
  if (!out.alreadyMember || out.joinedOrg) {
    await auditJoin(deps, { orgId: out.orgId, projectId: out.projectId, userId: input.userId, joinedOrg: out.joinedOrg });
  }
  return { projectId: out.projectId, orgId: out.orgId, joinedOrg: out.joinedOrg, alreadyMember: out.alreadyMember };
}

/* ───────────────────────── 匿名激活（全新用户） ───────────────────────── */

export interface ActivateProjectInvitationDeps {
  readonly invitations: ProjectInvitationRepository;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionTokenStore;
  /** 会话 id 工厂。与登录路径同一个端口——两份 id 生成器就是两种可猜测性。 */
  readonly tokens: TokenFactory;
  /** 既有邮箱验证流程的令牌编码器（链接邀请的验证邮件用它）。 */
  readonly verificationTokens: EmailVerificationTokenCodec;
  readonly provenance?: ProvenanceWriter;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
  readonly now?: () => Date;
}

export async function activateProjectInvitation(
  deps: ActivateProjectInvitationDeps,
  input: { readonly token: string; readonly name: string; readonly password: string; readonly email: string | null },
): Promise<ActivateOut> {
  const now = clock(deps);

  // 与注册 / 组织激活同一个 `checkPassword`；在查库之前判，口令太弱不会被折成「邀请失效」。
  const rejection = checkPassword(input.password);
  if (rejection !== null) throw new PasswordPolicyError(rejection);

  // 链接邀请的自填邮箱。邮箱邀请忽略它（仓储取邀请行里的邮箱）。形状不对先记下，
  // 仓储说「需要邮箱」时再报 EMAIL_INVALID（而不是无条件报——邮箱邀请根本不看这个字段）。
  const supplied = input.email === null ? "" : input.email.trim();
  const normalized = supplied === "" ? null : normalizeInviteEmail(supplied);
  const emailInvalid = normalized !== null && !isPlausibleEmail(normalized);
  const linkEmail = normalized !== null && !emailInvalid ? normalized : null;

  const userId = newUserId();
  const challengeId = deps.verificationTokens.newChallengeId();
  const result = await deps.invitations.activate({
    tokenHash: hashInvitationToken(input.token),
    now,
    userId,
    displayName: input.name,
    // 慢哈希在事务之外算（几百毫秒不该按住邀请行的锁）。
    passwordHash: await deps.hasher.hash(input.password),
    linkEmail,
    verification: {
      challengeId,
      tokenDigest: deps.verificationTokens.digest(deps.verificationTokens.tokenForChallenge(challengeId)),
      outboxId: `verify-${challengeId}`,
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    },
  });

  if (!result.ok) {
    switch (result.reason) {
      case "invalid":
        throw new ProjectInvitationError("INVITATION_INVALID");
      case "login-required":
        throw new ProjectInvitationError("LOGIN_REQUIRED");
      case "email-required":
        throw new ProjectInvitationError(emailInvalid ? "EMAIL_INVALID" : "EMAIL_REQUIRED");
      case "archived":
        throw new ProjectInvitationError("PROJECT_ARCHIVED");
      case "quota":
        throw new ProjectInvitationError("SEAT_QUOTA_EXHAUSTED");
    }
  }

  await auditJoin(deps, { orgId: result.orgId, projectId: result.projectId, userId: result.userId, joinedOrg: true });

  if (!result.emailVerified) {
    // 链接邀请：账号未验证、登录处是死路，直到验证邮件被点开。不发会话。
    return {
      userId: result.userId,
      orgId: result.orgId,
      projectId: result.projectId,
      verificationRequired: true,
      sessionId: null,
      session: null,
    };
  }

  // 会话在事务**之后**签发：会话存在 Redis，事务在 PostgreSQL，放进事务里既做不到原子，
  // 又会让「Redis 挂了」变成「成员没建成」。
  const record: SessionRecord = {
    id: deps.tokens.sessionId(),
    userId: result.userId,
    currentOrgId: result.orgId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_MS,
    revokedAt: null,
    // 同 activate-org-member.ts 的 F03 说明：这条路径没有采集设备上下文，如实兜底而不是编一个 "Web"。
    device: UNKNOWN_DEVICE,
    location: null,
    lastActiveAt: now.getTime(),
  };
  const session = await issueInvitationSession(deps.sessions, record);
  return {
    userId: result.userId,
    orgId: result.orgId,
    projectId: result.projectId,
    verificationRequired: false,
    sessionId: record.id,
    session,
  };
}
