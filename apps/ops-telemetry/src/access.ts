/**
 * Cloudflare Access JWT 校验：运营视图在 Access 应用后，但 Worker 不信任「前面有 Access」这件事本身——
 * 路由配错时它会被裸露。所以每个读请求都重验 `Cf-Access-Jwt-Assertion`：
 * RS256 签名（团队 JWKS）+ aud 含本应用 AUD + iss = 团队域名 + 未过期。
 * 未配置团队域名 / AUD → 503（fail-closed），绝不放行。
 */
export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export type AccessResult = { ok: true } | { ok: false; status: 401 | 503 };

interface Jwk extends JsonWebKey {
  kid?: string;
}

const b64urlBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function fetchKeys(team: string): Promise<Jwk[]> {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) return [];
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}

export async function verifyAccess(request: Request, env: AccessEnv, now = Date.now()): Promise<AccessResult> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud) return { ok: false, status: 503 };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401 };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401 };
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (header.alg !== "RS256") return { ok: false, status: 401 };
    const jwk = (await fetchKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return { ok: false, status: 401 };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return { ok: false, status: 401 };
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return { ok: false, status: 401 };
    if (payload.iss !== `https://${team}`) return { ok: false, status: 401 };
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return { ok: false, status: 401 };
    return { ok: true };
  } catch {
    return { ok: false, status: 401 };
  }
}
