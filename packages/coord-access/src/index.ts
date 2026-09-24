/**
 * Cloudflare Access JWT 校验——运营平面的**唯一实现**（D7 / D6）。
 *
 * 为什么放在 packages/coord-*：用到它的 devportal / ops-console / ops-telemetry 全在
 * `.harness/scripts/lib/ops-plane.mjs` 的 OPS_DIRS 里；coord-* 同属运营平面，三者都能合法依赖，
 * 生产面（apps/web 等）则被 lint-production-not-on-ops 挡住。
 *
 * 纵深防御：Access 在边缘拦一次，应用自己再验一遍 `Cf-Access-Jwt-Assertion`——路由配错 /
 * `*.pages.dev`、`*.workers.dev` 直连不经过 Access，头可以被伪造。
 * 校验项：RS256 签名（团队 certs 端点 JWK）+ aud 含本应用 AUD + iss = 团队域名 + 未过期。
 * **未配置团队域名或 AUD → 503（fail-closed），绝不放行**；不存在「只验签不验 aud」的降级档。
 */
export interface AccessConfig {
  /** 团队域名，`xxx.cloudflareaccess.com` 或带 `https://` 前缀均可。 */
  teamDomain?: string | null;
  /** Access 应用的 audience tag。 */
  aud?: string | null;
}

export type KeyResolver = (kid: string) => Promise<JsonWebKey | null>;

export type AccessClaims = Record<string, unknown> & { email?: string };

export type AccessResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; status: 401 | 403 | 503; error: "ACCESS_NOT_CONFIGURED" | "ACCESS_JWT_REQUIRED" | "ACCESS_JWT_INVALID" };

/** 规整团队域名为裸 host；空 / 只含空白 → null。 */
export function normalizeTeamDomain(raw: string | null | undefined): string | null {
  const t = raw?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return t ? t : null;
}

/** 仓库里的占位值（`__SET_…__` / `<aud tag>`）等同未配置。 */
const isPlaceholder = (v: string) => /^__SET_.*__$/.test(v) || /^<.*>$/.test(v);

/** 两项都非空且不是占位值才算配置完整。 */
export function resolveAccessConfig(cfg: AccessConfig): { team: string; aud: string } | null {
  const team = normalizeTeamDomain(cfg.teamDomain);
  const aud = cfg.aud?.trim();
  if (!team || !aud || isPlaceholder(team) || isPlaceholder(aud)) return null;
  return { team, aud };
}

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as Record<string, unknown>;

/** 纯校验：token 通过返回 claims，否则 null。配置不完整 → null（调用方应先用 resolveAccessConfig 区分 503）。 */
export async function verifyAccessJwt(
  token: string,
  cfg: AccessConfig,
  resolveKey: KeyResolver,
  nowSec = Date.now() / 1000,
): Promise<AccessClaims | null> {
  const c = resolveAccessConfig(cfg);
  if (!c) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = decodeJson(h);
    const payload = decodeJson(p);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = await resolveKey(header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(c.aud)) return null;
    if (payload.iss !== `https://${c.team}`) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return null;
    return payload as AccessClaims;
  } catch {
    return null;
  }
}

/** 生产用：从 `https://<team>/cdn-cgi/access/certs` 取 JWK。 */
export function certsResolver(teamDomain: string): KeyResolver {
  const team = normalizeTeamDomain(teamDomain);
  return async (kid) => {
    if (!team) return null;
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    return body.keys?.find((k) => k.kid === kid) ?? null;
  };
}

/**
 * 请求级门禁：未配置 → 503；缺头 → 401；无效 → 403。
 * `invalidStatus` 让已有 API 契约（如 ops-telemetry 用 401）保持不变。
 */
export async function checkAccess(
  headers: Headers,
  cfg: AccessConfig,
  opts: { resolveKey?: KeyResolver; nowSec?: number; invalidStatus?: 401 | 403 } = {},
): Promise<AccessResult> {
  const c = resolveAccessConfig(cfg);
  if (!c) return { ok: false, status: 503, error: "ACCESS_NOT_CONFIGURED" };
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, error: "ACCESS_JWT_REQUIRED" };
  const claims = await verifyAccessJwt(token, cfg, opts.resolveKey ?? certsResolver(c.team), opts.nowSec);
  if (!claims) return { ok: false, status: opts.invalidStatus ?? 403, error: "ACCESS_JWT_INVALID" };
  return { ok: true, claims };
}
