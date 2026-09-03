/**
 * Subject/text for the three `MailKind`s `Mailer.send()` can be asked to deliver
 * (`application/auth/ports.ts`), composed once so `DeliveringPasswordMailer` (real
 * delivery) does not duplicate what `OutboxMailer` already records verbatim.
 *
 * ⚠ `password-reset-link`'s link duration comes from `AUTH_POLICY.resetLinkHours` --
 * the same constant `password-reset.ts` uses to compute `expiresAt` -- rather than a
 * second "1 小时" written here by hand. Two copies of that number is exactly the kind
 * of drift this repo's single-source-of-truth discipline exists to prevent.
 *
 * ⚠ `account-locked` has no caller yet (`ports.ts`'s `MailKind` declares it, nothing
 * sends it) -- implemented anyway so the switch stays exhaustive against the type
 * rather than a `default` that would silently swallow a future kind nobody wrote
 * copy for.
 */
import { auth as C } from "@repo/contracts";
import type { MailKind } from "../../application/auth/ports";

export interface PasswordMailContent {
  readonly subject: string;
  readonly text: string;
}

/** `/auth/reset-password?token=...` -- the page issue #2602 adds to consume the link. */
export function resetLinkUrl(appPublicUrl: string, token: string): string {
  const base = appPublicUrl.replace(/\/+$/, "");
  return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

export function passwordMailContent(
  msg: { readonly kind: MailKind; readonly body: Record<string, string> },
  appPublicUrl: string,
): PasswordMailContent {
  switch (msg.kind) {
    case "password-reset-link": {
      const url = resetLinkUrl(appPublicUrl, msg.body.token ?? "");
      return {
        subject: "重置你的 WorkspaceX 密码",
        text: [
          "有人（希望是你）请求重置这个账号的登录密码。",
          `点击下面的链接设置新密码，链接 ${C.AUTH_POLICY.resetLinkHours} 小时内有效：`,
          url,
          "如果这不是你本人的操作，忽略这封邮件即可——密码不会被改动。",
        ].join("\n"),
      };
    }
    case "password-changed":
      return {
        subject: "你的 WorkspaceX 密码已修改",
        text: [
          "这个账号的登录密码刚刚被修改。",
          `修改时间：${msg.body.at ?? ""}`,
          `本次修改已让 ${msg.body.revokedSessionCount ?? "0"} 台已登录设备重新登录。`,
          "如果这不是你本人的操作，请立即用登录页的「忘记密码」重置密码，并检查账号安全。",
        ].join("\n"),
      };
    case "account-locked":
      return {
        subject: "你的 WorkspaceX 账号已被临时锁定",
        text: [
          "由于连续多次登录失败，这个账号已被临时锁定一段时间。",
          "如果这不是你本人的操作，建议尽快用「忘记密码」重置密码，并检查账号安全。",
        ].join("\n"),
      };
  }
}
