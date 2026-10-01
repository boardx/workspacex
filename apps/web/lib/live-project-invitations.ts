/**
 * 通用项目邀请（#4788）——契约 `projectInvitation.operations.*` 的真实 API 薄封装。
 * 类型全部由契约推导，不重新声明；人话文案取自契约的 `PROJECT_INVITATION_REASON_TEXT` /
 * `PROJECT_INVITATION_SEND_ERROR_TEXT`，不在前端另抄一份。
 */
import { projectInvitation } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest } from "./api-client";

const ops = projectInvitation.operations;

export type InvitationListItem = z.infer<typeof projectInvitation.ProjectInvitationListItem>;
export type InvitationStatus = z.infer<typeof projectInvitation.ProjectInvitationStatus>;
export type InvitationSendError = z.infer<typeof projectInvitation.ProjectInvitationSendError>;
export type CreateEmailInvitationsOut = z.infer<typeof ops.createProjectInvitations.out>;
export type EmailInvitationResult = CreateEmailInvitationsOut["invitations"][number];
export type EmailInvitationOutcome = z.infer<typeof projectInvitation.CreateEmailInvitationOutcome>;
export type IssueInviteLinkOut = z.infer<typeof ops.issueProjectInviteLink.out>;
export type ListInvitationsOut = z.infer<typeof ops.listProjectInvitations.out>;
export type ResendInvitationOut = z.infer<typeof ops.resendProjectInvitation.out>;
export type RevokeInvitationOut = z.infer<typeof ops.revokeProjectInvitation.out>;
export type PreviewInvitationOut = z.infer<typeof ops.previewProjectInvitation.out>;
export type InvitationNextStep = NonNullable<PreviewInvitationOut["nextStep"]>;
export type AcceptInvitationOut = z.infer<typeof ops.acceptProjectInvitation.out>;
export type ActivateInvitationIn = z.infer<typeof ops.activateProjectInvitation.in>;
export type ActivateInvitationOut = z.infer<typeof ops.activateProjectInvitation.out>;

export const MAX_EMAILS_PER_REQUEST = projectInvitation.PROJECT_INVITATION_LIMITS.emailsPerRequest;
export const INVITATION_TTL_DAYS = projectInvitation.PROJECT_INVITATION_LIMITS.ttlDays;
export const RESEND_COOLDOWN_SECONDS = projectInvitation.PROJECT_INVITATION_LIMITS.resendCooldownSeconds;
export const MAX_SENDS_PER_INVITATION = projectInvitation.PROJECT_INVITATION_LIMITS.maxSendsPerInvitation;

/** 落地页查询参数名（邮件 / 链接里是 `/projects/join?invite=<token>`）——单一声明处。 */
export const PROJECT_INVITATION_TOKEN_PARAM = "invite";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "待接受",
  accepted: "已接受",
  expired: "已过期",
  revoked: "已撤销",
};

export const EMAIL_OUTCOME_LABEL: Record<EmailInvitationOutcome, string> = {
  sent: "已发送",
  send_failed: "发送失败",
  already_pending: "已有待处理邀请",
  already_member: "已在项目里",
  invalid_email: "邮箱格式不对",
};

export function sendErrorText(code: InvitationSendError | null | undefined): string | null {
  if (!code) return null;
  return projectInvitation.PROJECT_INVITATION_SEND_ERROR_TEXT[code] ?? "邮件没有发出去，请稍后重发。";
}

export function projectInvitationReasonText(code: keyof typeof projectInvitation.PROJECT_INVITATION_REASON_TEXT): string {
  return projectInvitation.PROJECT_INVITATION_REASON_TEXT[code];
}

/** 失败信封 → 人话。契约错误码走契约文案；其余按 HTTP 状态兜底。不回显原始码。 */
export function describeInvitationFailure(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.reasonCode;
    const table: Readonly<Record<string, string>> = projectInvitation.PROJECT_INVITATION_REASON_TEXT;
    if (code && Object.prototype.hasOwnProperty.call(table, code)) return table[code] ?? "";
    if (e.status === 401) return "登录已失效，请重新登录。";
    if (e.status === 429) {
      const raw = e.raw as { retryAfterSeconds?: unknown } | undefined;
      const s = raw && typeof raw.retryAfterSeconds === "number" ? raw.retryAfterSeconds : null;
      return s !== null ? `操作太频繁了，请 ${s} 秒后再试。` : "操作太频繁了，请稍后再试。";
    }
    if (e.status >= 500) return "服务器出错了，请稍后再试一次。";
    return "这次请求没成功，请稍后再试一次。";
  }
  return "操作失败，请稍后再试。";
}

function path(template: string, projectId: string, invitationId?: string): string {
  const p = template.replace(":projectId", encodeURIComponent(projectId));
  return invitationId === undefined ? p : p.replace(":invitationId", encodeURIComponent(invitationId));
}

export function createEmailInvitations(projectId: string, emails: string[]): Promise<CreateEmailInvitationsOut> {
  return apiRequest<CreateEmailInvitationsOut>(path(ops.createProjectInvitations.path, projectId), {
    method: "POST", body: { projectId, emails },
  });
}

export function issueInviteLink(projectId: string): Promise<IssueInviteLinkOut> {
  return apiRequest<IssueInviteLinkOut>(path(ops.issueProjectInviteLink.path, projectId), {
    method: "POST", body: { projectId },
  });
}

export function listInvitations(projectId: string): Promise<ListInvitationsOut> {
  return apiRequest<ListInvitationsOut>(path(ops.listProjectInvitations.path, projectId), { method: "GET" });
}

export function resendInvitation(projectId: string, invitationId: string): Promise<ResendInvitationOut> {
  return apiRequest<ResendInvitationOut>(path(ops.resendProjectInvitation.path, projectId, invitationId), {
    method: "POST", body: { projectId, invitationId },
  });
}

export function revokeInvitation(projectId: string, invitationId: string): Promise<RevokeInvitationOut> {
  return apiRequest<RevokeInvitationOut>(path(ops.revokeProjectInvitation.path, projectId, invitationId), {
    method: "POST", body: { projectId, invitationId },
  });
}

export function previewInvitation(token: string): Promise<PreviewInvitationOut> {
  return apiRequest<PreviewInvitationOut>(ops.previewProjectInvitation.path, { method: "POST", body: { token } });
}

export function acceptInvitation(token: string): Promise<AcceptInvitationOut> {
  return apiRequest<AcceptInvitationOut>(ops.acceptProjectInvitation.path, { method: "POST", body: { token } });
}

/** 到期时间的人话：「10月7日 14:30」。无效输入原样返回。 */
export function formatInviteDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** 文本框里的邮箱清单 → 去重（忽略大小写）后的数组。分隔符：空白、逗号、分号、顿号。 */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;，；、]+/)) {
    const e = raw.trim();
    if (!e) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** 匿名调用：显式不带 bearer（避免旧会话头污染）。 */
export function activateInvitation(input: ActivateInvitationIn): Promise<ActivateInvitationOut> {
  return apiRequest<ActivateInvitationOut>(ops.activateProjectInvitation.path, {
    method: "POST", body: input, sessionToken: null,
  });
}
