/**
 * 通用事务性邮件端口——**不是** `VerificationMailTransport` 的第二份拷贝。
 *
 * ## 为什么不直接复用 `application/auth/email-verification-ports.ts` 的 `VerificationMailTransport`
 *
 * 那个端口的 `deliver()` 签名是 `{ outboxId, to, verificationUrl }`——固定的主题
 * （"Verify your WorkspaceX email"）、固定的正文模板（`Verify your email: <url>`）都
 * 硬编在 `CloudflareEmailTransport.deliver()` 内部，调用方**给不了**任意主题/正文。
 * 这是刻意的收窄，服务的是验证邮件那一个场景——把它掰开塞进"反馈状态变了"这种
 * 需要任意文案的场景，要么在验证语义里长出一堆"其实不是验证邮件"的分支，要么
 * 让 `verificationUrl` 这个参数名承载一段完全不相关的文本，两条路都是在借用一个
 * 名字不对的洞。
 *
 * 这个端口反过来：只关心"发一封任意主题/正文的邮件给某个收件人"，不知道、
 * 也不该知道调用方是验证流程还是反馈闭环——**内容由调用方（用例层）拼好再传进来**，
 * 端口本身不含任何业务文案。
 *
 * ## 与 `VerificationMailTransport` 共享的纪律（同一份，只是分两处落地）
 *
 *   · 适配器是窄 egress seam：只接 `fetch`，不依赖任何 SDK。
 *   · 配置校验在 `xxxConfig(env)` 里做一次，生产 fail-fast、非生产 permissive。
 *   · 测试永远注入 fake transport，见 `apps/api/tests/notifications/*`。
 *
 * 见 ADR-108（`docs/adr/ADR-108-transactional-email-generic-egress.md`）。
 */

export interface TransactionalMailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface TransactionalMailResult {
  readonly providerMessageId?: string;
}

export interface TransactionalMailTransport {
  send(message: TransactionalMailMessage): Promise<TransactionalMailResult>;
}

export const TRANSACTIONAL_MAIL_TRANSPORT = Symbol("TransactionalMailTransport");
