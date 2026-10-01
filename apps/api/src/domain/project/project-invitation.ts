/**
 * 通用项目邀请（#4787）的纯规则：令牌、邮箱规范化、状态派生、「这枚邀请现在能不能用」、重发限频。
 * 无 I/O。仓储与用例都从这里取判据，不各写一份。
 *
 * 数值（有效期 / 上限 / 冷却）的唯一声明点是契约 `PROJECT_INVITATION_LIMITS`，这里只读它。
 */
import { createHash, randomBytes } from "node:crypto";
import { projectInvitation as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole } from "../identity/roles";

export type InvitationKind = z.infer<typeof C.ProjectInvitationKind>;
export type InvitationStoredStatus = z.infer<typeof C.ProjectInvitationStatus>;
export type InvitationSendError = z.infer<typeof C.ProjectInvitationSendError>;

export const LIMITS = C.PROJECT_INVITATION_LIMITS;

/**
 * 因接受项目邀请而新成为组织成员的人得到的组织角色：权限最小的一档（选择与理由见契约
 * `INVITED_ORG_ROLE`）。授予组织成员资格的只有两处——`activateProjectInvitation` 与已登录的
 * `acceptProjectInvitation`——它们都读这个常量。
 */
export const INVITED_ORG_ROLE: OrgRole = C.INVITED_ORG_ROLE;

export const INVITATION_TTL_MS = LIMITS.ttlDays * 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = LIMITS.resendCooldownSeconds * 1000;
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 256 位 CSPRNG，base64url。持有它即可（在过期 / 撤销前）进项目，所以不落库明文。 */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 落库形态：SHA-256 十六进制。256 位随机值不需要慢哈希。 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 邀请行 id。不含可推导信息（会进列表与日志）。 */
export function newInvitationId(): string {
  return `pinv-${randomBytes(12).toString("hex")}`;
}

/** 与 `credentials.email` 同一口径：trim + 小写。不做 +tag / 点号折叠。 */
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 邮箱形状的粗判（有且仅有一个 @，两侧非空，域名含点，无空白，总长 ≤ 254）。
 * 不追求 RFC 全集：真正的可投递性由邮件服务商回答（`MAIL_RECIPIENT_REJECTED`）。
 */
export function isPlausibleEmail(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > 254) return false;
  if (/\s/.test(normalized)) return false;
  const at = normalized.indexOf("@");
  if (at <= 0 || at !== normalized.lastIndexOf("@")) return false;
  const domain = normalized.slice(at + 1);
  return domain.length > 2 && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export function expiresAtFrom(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

/**
 * 存储态 + 时钟 → 对外展示的状态。pending 且已过 expires_at ⇒ expired（读路径派生，
 * 不依赖定时任务把行翻成 expired）。**唯一一份派生规则**。
 */
export function deriveInvitationStatus(row: { status: InvitationStoredStatus; expiresAt: Date }, now: Date): InvitationStoredStatus {
  if (row.status === "pending" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status;
}

export interface InvitationUseInput {
  readonly kind: InvitationKind;
  readonly status: InvitationStoredStatus;
  readonly expiresAt: Date;
  /** 邮箱邀请绑定的邮箱（已规范化）；链接邀请为 null。 */
  readonly email: string | null;
  /** 使用者的邮箱（已登录接受时传登录账号的邮箱；匿名激活 / 预览传 null）。 */
  readonly viewerEmail: string | null;
}

/**
 * 这枚邀请现在能不能被使用：
 *   invalid        不存在 / 过期 / 撤销 / 已被用掉 —— 对外统一一种说法（`INVITATION_INVALID`）
 *   email-mismatch 邮箱邀请、但登录账号的邮箱不是受邀邮箱
 *   ok
 * 仓储在锁住邀请行之后调它；`invalid` 不带原因，防枚举。
 */
export function decideInvitationUse(input: InvitationUseInput, now: Date): "ok" | "invalid" | "email-mismatch" {
  if (deriveInvitationStatus({ status: input.status, expiresAt: input.expiresAt }, now) !== "pending") return "invalid";
  if (input.kind === "email" && input.viewerEmail !== null && input.email !== normalizeInviteEmail(input.viewerEmail)) {
    return "email-mismatch";
  }
  return "ok";
}

export interface ResendInput {
  readonly kind: InvitationKind;
  readonly status: InvitationStoredStatus;
  readonly expiresAt: Date;
  readonly sendAttempts: number;
  readonly lastSentAt: Date | null;
}

export type ResendVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-resendable" | "expired" | "too-soon" | "limit-reached"; readonly retryAfterMs?: number };

/** 重发判定。顺序：类型 → 状态（含按时间派生的过期）→ 上限 → 冷却（上限优先于冷却：到顶了等多久都没用）。 */
export function decideResend(row: ResendInput, now: Date): ResendVerdict {
  if (row.kind !== "email") return { ok: false, reason: "not-resendable" };
  const status = deriveInvitationStatus({ status: row.status, expiresAt: row.expiresAt }, now);
  if (status === "expired") return { ok: false, reason: "expired" };
  if (status !== "pending") return { ok: false, reason: "not-resendable" };
  if (row.sendAttempts >= LIMITS.maxSendsPerInvitation) return { ok: false, reason: "limit-reached" };
  if (row.lastSentAt !== null) {
    const elapsed = now.getTime() - row.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) return { ok: false, reason: "too-soon", retryAfterMs: RESEND_COOLDOWN_MS - elapsed };
  }
  return { ok: true };
}

/** 列表里的 `canResend`：`decideResend` 里除冷却之外的条件（冷却期内点了会被限频提示，按钮仍可点）。 */
export function canResendIgnoringCooldown(row: ResendInput, now: Date): boolean {
  const v = decideResend({ ...row, lastSentAt: null }, now);
  return v.ok;
}

/**
 * 邮件失败归类 → `last_send_error` 枚举码。输入是适配器归好的 `category`
 * （`configuration_missing` / `configuration_invalid` / `timeout` / `network` /
 * `provider_http_<状态码>` / `provider_invalid_response`），不是异常文本。
 * 服务商 400 / 422 视为拒收（地址不可投递）；401 / 403 是凭据问题，归「没配好」；其余一律「没发出去」。
 */
export function classifySendError(category: string | null): InvitationSendError {
  if (category === "configuration_missing" || category === "configuration_invalid") return "MAIL_NOT_CONFIGURED";
  const m = category === null ? null : /^provider_http_(\d{3})$/.exec(category);
  if (m !== null) {
    const status = Number(m[1]);
    if (status === 400 || status === 422) return "MAIL_RECIPIENT_REJECTED";
    if (status === 401 || status === 403) return "MAIL_NOT_CONFIGURED";
  }
  return "MAIL_SEND_FAILED";
}
