/** Organization admins invite ordinary members immediately, without peer review.
 * The controller delivers the newly issued bearer through OrgInvitationDelivery;
 * sent_at is written only after the transactional mail provider accepts it.
 */
import { normalizeEmail } from "../../domain/auth/registration";
import {
  newOrgInviteId,
  newOrgInviteToken,
  ORG_INVITE_LINK_VALIDITY_MS,
} from "../../domain/auth/org-invite";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { CreateOrgInviteResult, OrgInviteRepository } from "./org-invite-ports";

export interface InviteOrgMemberDeps {
  readonly repo: OrgInviteRepository;
  /** 注入，好让「7 天」这条能在不等 7 天的情况下被断言。 */
  readonly now?: () => Date;
}

export interface InviteOrgMemberInput {
  readonly orgId: OrgId;
  /**
   * 已由 Guard 认证过的调用者。
   * ⚠ 绝不从请求体里取——那是可伪造字段，而这条路径的整个前置条件是「他是管理员」。
   */
  readonly actorId: string;
  /** 调用者在本组织的角色，由 identity 侧解析后传入。 */
  readonly actorOrgRole: string;
  readonly email: string;
  readonly orgRole: string;
  readonly teamId: string | null;
}

export interface InviteOrgMemberOutput {
  readonly inviteId: string;
  readonly status: "pending" | "awaiting-review";
  /**
   * 本次预留的未分配额度条数（F11 起为真实账本，见 org-invite-ports.ts 的
   * `quota-exhausted` 注释与 `pg-org-invite-repository.ts` 的用尽判定）。
   *
   * ⚠ **幂等重放为 0**（`result.replayed`）——那一条 (org, email, orgRole, teamId)
   * 早在第一次调用时就已经占用过一个位置，重放不产生第二次占用。
   * 新建的邀请（无论 `pending` 还是 `awaiting-review`）都真实占用**一个**位置，为 1。
   */
  readonly quotaReserved: number;
  /** ⚠ `status = "awaiting-review"` 时恒为 false（I-3）。 */
  readonly tokenIssued: boolean;
  /**
   * 令牌明文。**只在签发响应里出现这一次**（契约 `OrgInvite` 实体刻意不含 token）。
   * 调用方要么把它拼进邮件，要么把它丢掉；不得回存。
   */
  readonly token: string | null;
}

export async function inviteOrgMember(
  deps: InviteOrgMemberDeps,
  input: InviteOrgMemberInput,
): Promise<InviteOrgMemberOutput> {
  // V7：项目负责人 / 顾问调用一律拒。
  //
  // ⚠ 判的是**调用者在本组织的角色**，不是「他有没有某个项目角色」。两层身份正交
  // （identity domain.md），而后台成员管理是组织层的事——用项目角色判这一条，
  // 会让一个在任意项目里当引导师的顾问获得邀请成员的能力。
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();
  const status = "pending" as const;

  // Legacy clients cannot use an invitation to grant administrative privileges.
  const token = newOrgInviteToken();
  const tokenExpiresAt =
    token === null ? null : new Date(now.getTime() + ORG_INVITE_LINK_VALIDITY_MS);

  const result: CreateOrgInviteResult = await deps.repo.create({
    inviteId: newOrgInviteId(),
    orgId: input.orgId,
    actorId: input.actorId,
    email: normalizeEmail(input.email),
    orgRole: "consultant",
    teamId: input.teamId,
    status,
    token,
    tokenExpiresAt,
  });

  if (!result.ok) {
    // I-9：配额用尽时**一律失败，且不产生任何 OrgInvite 行**——仓储在同一次锁定里判定
    // 并直接不插入（见 `pg-org-invite-repository.ts`），这里只是把三种失败原因翻成三个码。
    if (result.reason === "quota-exhausted") throw new OrgAdminError("QUOTA_EXHAUSTED");
    throw new OrgAdminError(
      result.reason === "already-member" ? "INVITE_ALREADY_MEMBER" : "INVITE_DUPLICATE",
    );
  }

  return {
    inviteId: result.inviteId,
    status,
    // 幂等重放不重复扣额度（usecases.md 逐字）；否则这是一次真实占用，为 1。
    quotaReserved: result.replayed ? 0 : 1,
    tokenIssued: result.tokenIssued,
    // 重放时不把既有邀请的令牌再吐一次：那等于任何一个管理员都能凭「再邀一次」
    // 把别人的激活链接读出来。重放的调用方拿到 inviteId，拿不到令牌。
    token: result.replayed ? null : token,
  };
}
