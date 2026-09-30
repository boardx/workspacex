/**
 * 通用项目邀请（#4787）· 负责人一侧的五个用例：批量邮箱邀请 / 签发·重置邀请链接 / 列表 / 重发 / 撤销。
 *
 * ## 谁能做：项目 owner —— 与 `addNonWorkshopMember` 同一道门
 *
 * `authorizeNonWorkshopMember(…, "manage")`：容器里的 owner 放行；collaborator ⇒ `PROJECT_ROLE_INSUFFICIENT`；
 * 容器没有任何 owner 时组织 lead/admin 可以当第一位（该门自带的旁路）；其余 ⇒ `ORG_ROLE_INSUFFICIENT` /
 * `NO_PROJECT_ROLE`。这里不另写一份判定（同一事实不得声明在两处）。
 *
 * ## 邮件失败必须可见
 *
 * 创建 / 重发先把行（连同 `send_attempts` 与 `last_sent_at`）落库，再调 `TransactionalMailTransport`。
 * 发送失败 ⇒ 归类成 `last_send_error` 枚举码写回，并随响应返回（`outcome: "send_failed"`）——邀请仍在，
 * 负责人可以稍后点「重发」。适配器的 `category` 只用来归类，不把异常文本带出去。
 *
 * ## 明文令牌只出现两处
 *
 * 邮件正文（邮箱邀请）与 `issueProjectInviteLink` 的响应（链接邀请）。库里只有 SHA-256，所以：
 * 链接邀请要新链接只能重置；邮箱邀请的重发 = 轮换令牌（旧邮件里的链接当场失效）。
 */
import { projectInvitation as C } from "@repo/contracts";
import type { z } from "zod";
import {
  LIMITS,
  canResendIgnoringCooldown,
  classifySendError,
  deriveInvitationStatus,
  expiresAtFrom,
  hashInvitationToken,
  isPlausibleEmail,
  newInvitationId,
  newInvitationToken,
  normalizeInviteEmail,
  type InvitationSendError,
} from "../../domain/project/project-invitation";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import { TransactionalMailError } from "../notifications/transactional-mail-ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ProjectError } from "./errors";
import { authorizeNonWorkshopMember, type NonWorkshopMemberActor, type NonWorkshopMemberDeps } from "./list-non-workshop-member";
import { ProjectInvitationError } from "./project-invitation-errors";
import { buildInvitationMail, buildInviteUrl } from "./project-invitation-mail";
import type { InvitationMailContext, ProjectInvitationRepository } from "./project-invitation-ports";

export interface ManageProjectInvitationsDeps extends NonWorkshopMemberDeps {
  readonly invitations: ProjectInvitationRepository;
  readonly mail: TransactionalMailTransport;
  /** 惰性取：生产配置缺项时读它会抛，不能在 DI 阶段就读。 */
  readonly appPublicUrl: () => string;
  readonly now?: () => Date;
  /** 测试注入点；生产缺省即 CSPRNG。 */
  readonly newToken?: () => string;
  readonly newId?: () => string;
}

type CreateOut = z.infer<typeof C.operations.createProjectInvitations.out>;
type ListOut = z.infer<typeof C.operations.listProjectInvitations.out>;
type ResendOut = z.infer<typeof C.operations.resendProjectInvitation.out>;
type LinkOut = z.infer<typeof C.operations.issueProjectInviteLink.out>;

const clock = (deps: { now?: () => Date }) => (deps.now ?? (() => new Date()))();

/**
 * 发一封邀请邮件。返回 `null` = 已交给传输层；否则是归好类的失败码。
 * 取 `appPublicUrl()`、拼正文、调传输层都在同一个 try 里：任何一步抛出都只会变成一个可见的失败码，
 * 不会让「邀请行已经落库」的请求变成 500。
 */
async function deliver(
  deps: ManageProjectInvitationsDeps,
  to: string,
  context: InvitationMailContext,
  token: string,
  expiresAt: Date,
): Promise<InvitationSendError | null> {
  try {
    const content = buildInvitationMail({
      projectName: context.projectName,
      inviterName: context.inviterName,
      appPublicUrl: deps.appPublicUrl(),
      token,
      expiresAt,
    });
    await deps.mail.send({ to, subject: content.subject, text: content.text });
    return null;
  } catch (e) {
    return classifySendError(e instanceof TransactionalMailError ? e.category : "unknown");
  }
}

async function gateForWrite(deps: ManageProjectInvitationsDeps, actor: NonWorkshopMemberActor) {
  const gate = await authorizeNonWorkshopMember(deps, actor, "manage");
  if (gate.container.status === "archived") throw new ProjectError("PROJECT_ARCHIVED");
  return gate;
}

/* ───────────────────────── 批量邮箱邀请 ───────────────────────── */

export async function createProjectInvitations(
  deps: ManageProjectInvitationsDeps,
  input: NonWorkshopMemberActor & { readonly emails: readonly string[] },
): Promise<CreateOut> {
  await gateForWrite(deps, input);
  const now = clock(deps);
  const newToken = deps.newToken ?? newInvitationToken;
  const newId = deps.newId ?? newInvitationId;

  // 规范化 + 形状粗判 + 去重（同一个邮箱在一批里出现多次只建一条，回显里各自带同一个结果）。
  const order = input.emails.map((raw) => ({ raw: raw.trim(), normalized: normalizeInviteEmail(raw) }));
  const fresh = new Map<string, { email: string; invitationId: string; token: string; tokenHash: string; expiresAt: Date }>();
  for (const o of order) {
    if (!isPlausibleEmail(o.normalized) || fresh.has(o.normalized)) continue;
    const token = newToken();
    fresh.set(o.normalized, {
      email: o.normalized,
      invitationId: newId(),
      token,
      tokenHash: hashInvitationToken(token),
      expiresAt: expiresAtFrom(now),
    });
  }

  const results = new Map<string, CreateOut["invitations"][number]>();
  if (fresh.size > 0) {
    const prepared = await deps.invitations.prepareEmailInvitations({
      orgId: input.orgId,
      projectId: input.projectId,
      invitedBy: input.actorId,
      now,
      dailyCap: LIMITS.dailyCapPerProject,
      items: [...fresh.values()].map(({ email, invitationId, tokenHash, expiresAt }) => ({ email, invitationId, tokenHash, expiresAt })),
    });
    if (!prepared.ok) throw new ProjectInvitationError("DAILY_CAP_REACHED");

    await Promise.all(
      prepared.items.map(async (item) => {
        const plan = fresh.get(item.email);
        if (item.outcome !== "created") {
          results.set(item.email, { email: item.email, invitationId: item.invitationId, outcome: item.outcome, lastSendError: null });
          return;
        }
        if (plan === undefined) return; // 仓储只会回我们提交过的邮箱；不可达。
        const error = await deliver(deps, item.email, prepared.context, plan.token, plan.expiresAt);
        if (error !== null) {
          // 回写失败本身不能盖掉「邮件没发出去」这个事实：回写抛了就让它抛（500 好过静默丢失这条信号）。
          await deps.invitations.recordSendFailure({ orgId: input.orgId, invitationId: item.invitationId, error });
        }
        results.set(item.email, {
          email: item.email,
          invitationId: item.invitationId,
          outcome: error === null ? "sent" : "send_failed",
          lastSendError: error,
        });
      }),
    );
  }

  return {
    invitations: order.map((o) => {
      const hit = results.get(o.normalized);
      if (hit !== undefined) return { ...hit, email: o.raw };
      return { email: o.raw, invitationId: null, outcome: "invalid_email" as const, lastSendError: null };
    }),
  };
}

/* ───────────────────────── 邀请链接 ───────────────────────── */

export async function issueProjectInviteLink(
  deps: ManageProjectInvitationsDeps,
  input: NonWorkshopMemberActor,
): Promise<LinkOut> {
  await gateForWrite(deps, input);
  const now = clock(deps);
  // 先取公开地址：配置有问题就在落库之前失败，而不是签发了一条谁也拿不到的链接。
  const appPublicUrl = deps.appPublicUrl();
  const token = (deps.newToken ?? newInvitationToken)();
  const invitationId = (deps.newId ?? newInvitationId)();
  const expiresAt = expiresAtFrom(now);

  const out = await deps.invitations.issueLink({
    orgId: input.orgId,
    projectId: input.projectId,
    invitedBy: input.actorId,
    now,
    dailyCap: LIMITS.dailyCapPerProject,
    invitationId,
    tokenHash: hashInvitationToken(token),
    expiresAt,
  });
  if (!out.ok) throw new ProjectInvitationError("DAILY_CAP_REACHED");
  return {
    invitationId,
    inviteUrl: buildInviteUrl(appPublicUrl, token),
    expiresAt: expiresAt.toISOString(),
    replacedInvitationId: out.replacedInvitationId,
  };
}

/* ───────────────────────── 列表 ───────────────────────── */

export async function listProjectInvitations(
  deps: ManageProjectInvitationsDeps,
  input: NonWorkshopMemberActor,
): Promise<ListOut> {
  const gate = await authorizeNonWorkshopMember(deps, input, "manage");
  const now = clock(deps);
  const guarded = await deps.invitations.list(input.orgId, input.projectId);
  const d = discloseDecided(guarded, gate.decision);
  // 上面已按 reason 抛过，这一支理论不可达；到达时按无权限处理而不是放行。
  if (!isDisclosed(d)) throw new ProjectError("NO_PROJECT_ROLE");
  return {
    invitations: d.payload.map((row) => ({
      invitationId: row.invitationId,
      kind: row.kind,
      email: row.email,
      role: row.role,
      status: deriveInvitationStatus({ status: row.status, expiresAt: row.expiresAt }, now),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      invitedByName: row.invitedByName,
      lastSentAt: row.lastSentAt === null ? null : row.lastSentAt.toISOString(),
      sendAttempts: row.sendAttempts,
      lastSendError: row.lastSendError,
      canResend: canResendIgnoringCooldown(
        { kind: row.kind, status: row.status, expiresAt: row.expiresAt, sendAttempts: row.sendAttempts, lastSentAt: row.lastSentAt },
        now,
      ),
    })),
  };
}

/* ───────────────────────── 重发 ───────────────────────── */

export async function resendProjectInvitation(
  deps: ManageProjectInvitationsDeps,
  input: NonWorkshopMemberActor & { readonly invitationId: string },
): Promise<ResendOut> {
  await gateForWrite(deps, input);
  const now = clock(deps);
  const token = (deps.newToken ?? newInvitationToken)();

  const prepared = await deps.invitations.prepareResend({
    orgId: input.orgId,
    projectId: input.projectId,
    invitationId: input.invitationId,
    actorId: input.actorId,
    now,
    newTokenHash: hashInvitationToken(token),
  });
  if (!prepared.ok) {
    switch (prepared.reason) {
      case "not-found":
        throw new ProjectInvitationError("INVITATION_NOT_FOUND");
      case "not-resendable":
        throw new ProjectInvitationError("INVITATION_NOT_RESENDABLE");
      case "expired":
        throw new ProjectInvitationError("INVITATION_EXPIRED");
      case "too-soon":
        throw new ProjectInvitationError("RESEND_TOO_SOON", Math.ceil((prepared.retryAfterMs ?? 0) / 1000));
      case "limit-reached":
        throw new ProjectInvitationError("RESEND_LIMIT_REACHED");
    }
  }

  const error = await deliver(deps, prepared.email, prepared.context, token, prepared.expiresAt);
  if (error !== null) {
    await deps.invitations.recordSendFailure({ orgId: input.orgId, invitationId: input.invitationId, error });
  }
  return {
    invitationId: input.invitationId,
    outcome: error === null ? "sent" : "send_failed",
    lastSendError: error,
    sendAttempts: prepared.sendAttempts,
    lastSentAt: prepared.lastSentAt.toISOString(),
    remainingSends: Math.max(0, LIMITS.maxSendsPerInvitation - prepared.sendAttempts),
  };
}

/* ───────────────────────── 撤销 ───────────────────────── */

export async function revokeProjectInvitation(
  deps: ManageProjectInvitationsDeps,
  input: NonWorkshopMemberActor & { readonly invitationId: string },
): Promise<{ invitationId: string; status: "revoked" }> {
  // 撤销不挡归档：归档项目上的待接受邀请正是该被收回的东西。
  await authorizeNonWorkshopMember(deps, input, "manage");
  const out = await deps.invitations.revoke({ orgId: input.orgId, projectId: input.projectId, invitationId: input.invitationId });
  if (out === "not-found") throw new ProjectInvitationError("INVITATION_NOT_FOUND");
  if (out === "already-accepted") throw new ProjectInvitationError("INVITATION_ALREADY_ACCEPTED");
  return { invitationId: input.invitationId, status: "revoked" };
}
