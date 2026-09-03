/**
 * `MAIL_FROM` 必须落在 Cloudflare Email Sending 实际 onboard 的发信域名上——单一事实源。
 *
 * ## 这个校验在防什么
 *
 * 2026-09-03 本地和生产各栽了一次同款事故：`MAIL_FROM` 配成了根域 `boardx.us`
 * 而不是已 onboard 的子域 `mail.boardx.us`。Cloudflare 对这种情况**不是整体拒绝**——
 * 发往外部域名（gmail.com 等）照常成功，只有发给「收件人也在 `boardx.us`」这种
 * 同域场景才会以 `email.sending.error.email.invalid` 拒信。于是症状看起来像是
 * "对某些收件人发不出去"，而不是"发信配置错了"，排查成本很高，且只有在真的
 * 撞上同域收件人时才会暴露——生产环境可能带着这个错误配置运行很久都不触发。
 *
 * ⇒ 与其等运行时撞见这种偏门失败模式，不如在配置装配阶段就把
 *   "MAIL_FROM 的域名是不是 Cloudflare 那边真的认的那个域" 校验掉。
 *
 * ## 为什么不在两个 transport 各写一遍
 *
 * `CloudflareEmailTransport`（验证邮件）与 `CloudflareTransactionalEmailTransport`
 * （事务通知）已经在复用 `CLOUDFLARE_ACCOUNT_ID` / `MAIL_FROM`（ADR-108）。
 * 期望域名是同一个部署事实，写两份字面量只会制造"改一个忘了改另一个"的漂移——
 * 这正是 AGENTS.md 里"同一事实不得声明在两处"要防的东西。
 *
 * ## 为什么默认值可以硬编码,又留了环境变量口子
 *
 * 当前已 onboard 的发信域是 `mail.boardx.us`（ADR-104 记录的部署事实,
 * `wrangler email sending list` 可现场核验)。这是一个部署事实,不是运行时可变的东西,
 * 硬编码默认值是诚实的——但域名迁移不该需要改代码才能生效,所以留了
 * `CLOUDFLARE_EMAIL_SENDING_DOMAIN` 环境变量覆盖口子。
 *
 * ## 为什么只在生产校验
 *
 * 与 `cloudflareEmailConfig`/`transactionalMailConfig` 既有的
 * "生产 fail-fast / 非生产 permissive" 纪律一致——测试和本地开发大量使用
 * `verify@example.test` 这类任意域名的 fixture,不该被这条校验拖下水。
 */

export const CLOUDFLARE_EMAIL_SENDING_DOMAIN_DEFAULT = "mail.boardx.us";

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

export function expectedCloudflareEmailSendingDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CLOUDFLARE_EMAIL_SENDING_DOMAIN ?? CLOUDFLARE_EMAIL_SENDING_DOMAIN_DEFAULT).toLowerCase();
}

/**
 * 生产环境下,`mailFrom` 的域名必须等于已 onboard 的发信域名,否则抛出。
 * 非生产环境不校验——调用方按 `cloudflareEmailConfig`/`transactionalMailConfig`
 * 既有的生产判定自行决定是否调用。
 */
export function assertMailFromOnSendingDomain(mailFrom: string, env: NodeJS.ProcessEnv = process.env): void {
  const expected = expectedCloudflareEmailSendingDomain(env);
  const actual = domainOf(mailFrom);
  if (actual !== expected) {
    throw new Error(
      `MAIL_FROM domain "${actual || mailFrom}" does not match the Cloudflare Email Sending onboarded domain ` +
        `"${expected}" — sends to recipients on the misconfigured domain will be rejected even though sends to ` +
        `unrelated domains succeed`,
    );
  }
}
