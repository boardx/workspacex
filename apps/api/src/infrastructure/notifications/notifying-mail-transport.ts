import type { TransactionalMailMessage, TransactionalMailResult, TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { CredentialRepository } from "../../application/auth/ports";
import { normalizeEmail } from "../../domain/auth/email";
/**
 * 装饰 `TRANSACTIONAL_MAIL_TRANSPORT`：每封真实发出的邮件，如果收件人是本系统的注册用户，
 * 就同步推一条 `email` 通知到该用户的通知中心（跨组织：`orgId=null`）。
 * 邮件正文**不**进通知——密码重置链接等一次性凭证不该出现在第二个地方；通知只带主题。
 * 推送失败不影响邮件已发出的事实。
 */
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
        orgId: null, userId: account.userId, kind: "email", title: `邮件：${message.subject}`,
        body: `已向 ${message.to} 发送一封邮件。`, sourceKey: result.providerMessageId ? `mail:${result.providerMessageId}` : null,
      });
    } catch (err) {
      this.log("mail notification failed", { to: message.to, err });
    }
    return result;
  }
}
