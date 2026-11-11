import { INBOX_INVITE_SOURCE_PREFIX } from "@repo/contracts/notifications";
import type { TransactionalMailMessage, TransactionalMailResult, TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { CredentialRepository } from "../../application/auth/ports";
import { normalizeEmail } from "../../domain/auth/email";
/** Copies successful delivery summaries to the recipient's inbox.
 * Invitation notices carry an invitation ID rather than the email's bearer link. */
export class NotifyingMailTransport implements TransactionalMailTransport {
  constructor(
    private readonly inner: TransactionalMailTransport,
    private readonly credentials: Pick<CredentialRepository, "findByEmail">,
    private readonly notifications: NotificationPublisher,
    private readonly log: (message: string, detail: Record<string, unknown>) => void,
  ) {}
  async send(message: TransactionalMailMessage): Promise<TransactionalMailResult> {
    const result = await this.inner.send(message);
    try {
      const account = await this.credentials.findByEmail(normalizeEmail(message.to));
      if (account) await this.notifications.publish({
        orgId: null, userId: account.userId, kind: "email", title: message.orgInviteId ? message.subject : `邮件：${message.subject}`,
        body: message.orgInviteId ? "你收到了一份组织邀请。可在这里查看并确认加入。" : `已向 ${message.to} 发送一封邮件。`,
        sourceKey: message.orgInviteId
          ? `${INBOX_INVITE_SOURCE_PREFIX}${message.orgInviteId}`
          : result.providerMessageId ? `mail:${result.providerMessageId}` : null,
      });
    } catch (err) {
      this.log("mail notification failed", { to: message.to, err });
    }
    return result;
  }
}
