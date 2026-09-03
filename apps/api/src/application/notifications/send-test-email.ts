/**
 * `sendTestEmail` —— 平台超管从后台发一封测试邮件，走的是**生产同一条**
 * `TransactionalMailTransport`（Cloudflare 事务邮件），不是另一套"测试用"通路：
 * 测的就是这个部署真实的发信能力，换一条通路测出来的绿没有意义。
 *
 * 为什么需要它：反馈确认邮件 / 状态变更邮件都是 best-effort、失败只记日志，运维
 * 在没有这条路由之前只能等真实用户提一条反馈再去翻日志才知道"邮件到底发不发得出"。
 *
 * ⚠ 这里**不**吞错：与 best-effort 的那两处相反，测试邮件的全部意义就是把失败
 *   如实报出来——`TransactionalMailTransport` 抛什么，控制器就按类别映射成契约错误码。
 */
import type { TransactionalMailTransport } from "./transactional-mail-ports";

export interface SendTestEmailDeps {
  readonly mail: TransactionalMailTransport;
  /** 没传收件人时，查当前账号的邮箱（同反馈通知用的目录）。 */
  readonly recipients: { emailForUserId(userId: string): Promise<string | null> };
  readonly now: () => Date;
}

export interface SendTestEmailInput {
  readonly actorUserId: string;
  readonly to: string | null;
  readonly traceId: string;
}

export interface SendTestEmailResult {
  readonly sentTo: string;
  readonly subject: string;
  readonly providerMessageId: string | null;
  readonly sentAt: string;
}

export class NoTestEmailRecipientError extends Error {}

export function testEmailContent(input: { readonly actorUserId: string; readonly traceId: string; readonly at: Date }) {
  const stamp = input.at.toISOString();
  return {
    subject: `WorkspaceX 测试邮件 ${stamp}`,
    text: [
      "这是一封由后台「系统异常 → 测试邮件」发出的测试邮件。收到即说明这个部署的事务邮件通路可用。",
      `触发账号：${input.actorUserId}`,
      `traceId：${input.traceId}`,
      `时间：${stamp}`,
    ].join("\n"),
  };
}

export async function sendTestEmail(deps: SendTestEmailDeps, input: SendTestEmailInput): Promise<SendTestEmailResult> {
  const to = input.to ?? (await deps.recipients.emailForUserId(input.actorUserId));
  if (to === null || to.trim() === "") throw new NoTestEmailRecipientError();
  const at = deps.now();
  const { subject, text } = testEmailContent({ actorUserId: input.actorUserId, traceId: input.traceId, at });
  const result = await deps.mail.send({ to, subject, text });
  return { sentTo: to, subject, providerMessageId: result.providerMessageId ?? null, sentAt: at.toISOString() };
}
