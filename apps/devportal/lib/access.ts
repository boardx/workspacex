// Cloudflare Access 身份层 — 替代产品面的 @/lib/session（#523 Track A 门禁解耦）。
// develop.boardx.us 整域由 Cloudflare Access（GitHub 登录）保护；请求到达本应用时
// Access 已注入两个头：
//   Cf-Access-Authenticated-User-Email — 登录者邮箱（不可信，不读）
//   Cf-Access-Jwt-Assertion            — 签名 JWT（RS256，团队证书端点可验签）
// 必须验签而不能只信 email 头：*.pages.dev 直连不经过 Access，攻击者可手工伪造头。
//
// 校验实现只在 @repo/coord-access（单一事实源，D7）：签名 + aud + iss + exp。
// CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN 任一未配置 → fail-closed：Access 通道一律不认
// （返回 null，调用方按未登录处理；OAuth 通道不受影响）。#769 的「未配 aud 只警告」降级档已删除。
import { certsResolver, resolveAccessConfig, verifyAccessJwt, type KeyResolver } from "@repo/coord-access";

export interface AccessUser {
  email: string;
}

let warnedUnconfigured = false;

/** 从请求头解析并验证 Access 身份；无 Access 上下文 / 未配置 / 验签失败 → null。 */
export async function accessUser(headers: Headers, resolveKey?: KeyResolver): Promise<AccessUser | null> {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (!assertion) return null;
  const cfg = { teamDomain: process.env["CF_ACCESS_TEAM_DOMAIN"], aud: process.env["CF_ACCESS_AUD"] };
  const resolved = resolveAccessConfig(cfg);
  if (!resolved) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.error("[access] CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN 未配置：Access 通道 fail-closed，所有 Access JWT 被拒。");
    }
    return null;
  }
  const claims = await verifyAccessJwt(assertion, cfg, resolveKey ?? certsResolver(resolved.team));
  const email = typeof claims?.["email"] === "string" ? claims["email"] : null;
  return email ? { email } : null;
}

/** owner 匹配辅助：registry 的 owner 字段现值为 GitHub login（usamshen），Access 给的是
 *  邮箱（usam.shen@gmail.com）。ADR-011 P1（身份权威迁 D1）落地前的过渡匹配：
 *  精确邮箱相等，或邮箱 local-part 去点后等于 owner（usam.shen → usamshen）。 */
export function ownerMatches(owner: string | null | undefined, email: string): boolean {
  if (!owner) return false;
  if (owner === email) return true;
  const local = email.split("@")[0] ?? "";
  return local.replace(/\./g, "").toLowerCase() === owner.toLowerCase();
}
