/**
 * `InviteOrgMember` (F10 / UC-1.6) —— 编排。不知道 HTTP，不知道 PostgreSQL。
 *
 * ## 这里做的三件事，和刻意没做的一件
 *
 * 做：① 越权判定（只有管理员能邀）② 由被邀角色推出初始状态与「签不签令牌」（I-3）
 *     ③ 邮箱规范化。
 * 不做：**发信**。usecases.md 说邮件异步、接口 1 秒内返回 pending，送达结果由
 * `sentAt` 与 `status` 表达；而 `MAIL_UNAVAILABLE` 要求「记录标 send-failed，
 * 不产生可激活链接假象（V12）」。本 feature 落地的是**出站队列的位置**
 * （`org_invites.sent_at` 为 NULL = 还没发出去），投递器本身不在 F10 里——
 * 与 phase-00 的 `email_verification_tokens` 完全相同的处境，并且同样**明说**，
 * 而不是绑一个「记个日志然后返回成功」的 Mailer：那种实现会让
 * `sentAt` 上的承诺变成一句没有任何测试能戳穿的谎。
 */
import { normalizeEmail } from "../../domain/auth/registration";
import {
  initialInviteStatus,
  needsDualReview,
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
   * 本次预留的未分配额度条数。
   *
   * ⚠ **恒为 0，因为 phase-01 里还没有配额账本**（`QuotaLedger` 属 F11）。
   * 返回 0 是「本次没有预留任何额度」这一**真话**；返回 1 会让界面上的剩余额度
   * 与库里的事实分叉，而没有任何东西会报错。`QUOTA_EXHAUSTED` 因此在本 feature 里
   * **不可能被抛出**——这是缺口，写在这里而不是让下一个人从空实现里推断。
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
  const status = initialInviteStatus(input.orgRole);

  // I-3：待复核的管理员邀请不签发令牌。两个值一起算出来，
  // 所以「status 是 awaiting-review 但 token 非空」在本文件里连表达都表达不出来。
  const token = needsDualReview(input.orgRole) ? null : newOrgInviteToken();
  const tokenExpiresAt =
    token === null ? null : new Date(now.getTime() + ORG_INVITE_LINK_VALIDITY_MS);

  const result: CreateOrgInviteResult = await deps.repo.create({
    inviteId: newOrgInviteId(),
    orgId: input.orgId,
    actorId: input.actorId,
    email: normalizeEmail(input.email),
    orgRole: input.orgRole,
    teamId: input.teamId,
    status,
    token,
    tokenExpiresAt,
  });

  if (!result.ok) {
    throw new OrgAdminError(
      result.reason === "already-member" ? "INVITE_ALREADY_MEMBER" : "INVITE_DUPLICATE",
    );
  }

  return {
    inviteId: result.inviteId,
    status,
    // 幂等重放不重复扣额度（usecases.md 逐字）。这里恒 0 的理由见 `quotaReserved` 的注释。
    quotaReserved: 0,
    tokenIssued: result.tokenIssued,
    // 重放时不把既有邀请的令牌再吐一次：那等于任何一个管理员都能凭「再邀一次」
    // 把别人的激活链接读出来。重放的调用方拿到 inviteId，拿不到令牌。
    token: result.replayed ? null : token,
  };
}
