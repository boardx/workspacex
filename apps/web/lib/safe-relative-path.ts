/**
 * 校验一个"回跳目的地"字符串是不是一个安全的**同源相对路径**——用于把 `?from=`
 * 这类由调用方（前端自己拼的链接）传入、但最终会落进 `router.push`/`<Link href>`
 * 的值，先过一遍再用，而不是原样信任。
 *
 * ⚠ 这不是防外部攻击者的第一道门（`?from=` 目前只由本仓自己的入口拼出，不接受
 *   用户输入的任意字符串），而是防"这个值以后被接到别的调用点、变成能被外部
 *   操纵"的那一天——一个开放重定向漏洞的典型成因就是"当初只有可信调用方，
 *   后来加了个新入口，没人想起要重新审这条校验"。校验只做一件事：拒绝任何
 *   不是「以单个 `/` 开头的同源路径」的值（协议相对 `//host/...`、绝对 URL
 *   `https://...`、`javascript:` 等全部落在"不合法"里，回落到调用方的默认值）。
 */
export function safeRelativePath(value: string | null | undefined): string | null {
  if (!value) return null;
  // 单个 `/` 开头，且不是 `//`（协议相对 URL，浏览器会当成跳到另一个 host）。
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // 反斜杠常被浏览器当正斜杠解析（`/\evil.com` → `//evil.com`）——同一类风险。
  if (value.startsWith("/\\")) return null;
  return value;
}
