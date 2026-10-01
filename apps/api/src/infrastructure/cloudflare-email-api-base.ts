/**
 * Cloudflare Email Sending API 的 base URL——两个 transport（验证邮件 / 事务邮件）共用的单一事实源（#4789）。
 *
 * ## 为什么开了一个环境变量口子
 *
 * 此前 `https://api.cloudflare.com/client/v4` 硬编码在两个 transport 里，CI 里没有任何办法观察
 * "产品到底发了什么邮件"。`apps/api/scripts/loopback-mail-provider.ts` 是与 ASR/模型回环同型的
 * 确定性替身，本变量是把 transport 指向它的**唯一**入口。
 *
 * ## 为什么不是隐式回退
 *
 * 只认 `CLOUDFLARE_API_BASE_URL` 这一个变量，未设 ⇒ 永远是官方地址；没有 list、没有 map。
 * **生产环境里它只能等于官方默认值**，其它任何值直接抛错（fail fast），而不是悄悄照办——
 * 否则一个误配就能把生产邮件（含验证链接）发到任意主机。
 */
export const CLOUDFLARE_API_BASE_URL_DEFAULT = "https://api.cloudflare.com/client/v4";

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function cloudflareApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CLOUDFLARE_API_BASE_URL;
  if (raw === undefined || raw.trim() === "") return CLOUDFLARE_API_BASE_URL_DEFAULT;
  const value = normalize(raw);
  if (env.NODE_ENV === "production" && value !== CLOUDFLARE_API_BASE_URL_DEFAULT) {
    throw new Error("CLOUDFLARE_API_BASE_URL must not be overridden in production");
  }
  let protocol = "";
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("CLOUDFLARE_API_BASE_URL must be an absolute http(s) URL");
  }
  return value;
}

/** transport 用：config 里没有 `apiBaseUrl`（老测试夹具 / 手工构造）时回落到官方地址。 */
export function cloudflareEmailSendUrl(apiBaseUrl: string | undefined, accountId: string): string {
  return `${apiBaseUrl ?? CLOUDFLARE_API_BASE_URL_DEFAULT}/accounts/${encodeURIComponent(accountId)}/email/sending/send`;
}
