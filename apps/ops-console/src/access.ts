/**
 * Cloudflare Access JWT 校验（纵深防御：Access 在边缘拦一次，Worker 再验一次）。
 * 验 RS256 签名（团队 certs 端点的 JWK）、aud、iss、exp。任何一项不过即拒。
 */
export interface AccessConfig { teamDomain: string; aud: string }
export type KeyResolver = (kid: string) => Promise<JsonWebKey | null>;

const b64urlToBytes = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as Record<string, unknown>;

export async function verifyAccessJwt(token: string, cfg: AccessConfig, resolveKey: KeyResolver, nowSec = Date.now() / 1000): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts as [string, string, string];
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = decodeJson(h); payload = decodeJson(p); } catch { return false; }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  const jwk = await resolveKey(header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return false;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(cfg.aud)) return false;
  if (payload.iss !== `https://${cfg.teamDomain}`) return false;
  return typeof payload.exp === "number" && payload.exp > nowSec;
}

/** 生产用：从 `https://<team>/cdn-cgi/access/certs` 取 JWK。 */
export function certsResolver(teamDomain: string): KeyResolver {
  return async (kid) => {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    return body.keys?.find((k) => k.kid === kid) ?? null;
  };
}
