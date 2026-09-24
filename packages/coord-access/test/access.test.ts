import { beforeAll, describe, expect, it } from "vitest";
import { checkAccess, normalizeTeamDomain, verifyAccessJwt, type KeyResolver } from "../src/index";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-1";
const NOW = 1_800_000_000;
let resolveKey: KeyResolver;
let priv: CryptoKey;

const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? new TextEncoder().encode(b) : b).toString("base64url");

async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }, key = priv) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}
const good = (over: Record<string, unknown> = {}) =>
  sign({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 600, email: "a@b.c", ...over });

const gen = () =>
  crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

beforeAll(async () => {
  const kp = await gen();
  priv = kp.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  resolveKey = async (kid) => (kid === "k1" ? jwk : null);
});

const cfg = { teamDomain: TEAM, aud: AUD };
const hdr = (t?: string) => new Headers(t ? { "cf-access-jwt-assertion": t } : {});

describe("verifyAccessJwt", () => {
  it("有效 token → claims", async () => {
    expect((await verifyAccessJwt(await good(), cfg, resolveKey, NOW))?.email).toBe("a@b.c");
  });
  it("团队域名带 https:// 前缀也等价", async () => {
    expect(await verifyAccessJwt(await good(), { teamDomain: `https://${TEAM}/`, aud: AUD }, resolveKey, NOW)).not.toBeNull();
    expect(normalizeTeamDomain("  ")).toBeNull();
  });
  it("反例：aud 不符 / iss 不符 / 过期 / 无 exp / 错 alg / 未知 kid / 篡改 / 他人私钥 → null", async () => {
    const other = (await gen()).privateKey;
    const t = await good();
    const bad = [
      await good({ aud: ["other"] }),
      await good({ iss: "https://evil.cloudflareaccess.com" }),
      await good({ exp: NOW - 1 }),
      await good({ exp: undefined }),
      await sign({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 1 }, { alg: "HS256", kid: "k1" }),
      await sign({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 1 }, { alg: "RS256", kid: "k2" }),
      await sign({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 1 }, undefined, other),
      t.slice(0, -4) + "AAAA",
      "not.a.jwt",
      "x",
    ];
    for (const b of bad) expect(await verifyAccessJwt(b, cfg, resolveKey, NOW)).toBeNull();
  });
  it("反例：未配置 aud 时即使 token 有效也不放行（无降级档）", async () => {
    expect(await verifyAccessJwt(await good(), { teamDomain: TEAM, aud: "" }, resolveKey, NOW)).toBeNull();
    expect(await verifyAccessJwt(await good(), { teamDomain: TEAM }, resolveKey, NOW)).toBeNull();
  });
});

describe("checkAccess（fail-closed）", () => {
  it("未配置 AUD 或团队域名 → 503，不看 token", async () => {
    for (const c of [{}, { teamDomain: TEAM }, { aud: AUD }, { teamDomain: " ", aud: AUD }, { teamDomain: TEAM, aud: " " }, { teamDomain: TEAM, aud: "__SET_CF_ACCESS_AUD__" }, { teamDomain: TEAM, aud: "<aud tag>" }]) {
      expect(await checkAccess(hdr(await good()), c, { resolveKey, nowSec: NOW })).toMatchObject({ ok: false, status: 503 });
    }
  });
  it("缺头 → 401；无效 → 403（可改 401）；有效 → ok", async () => {
    expect(await checkAccess(hdr(), cfg, { resolveKey, nowSec: NOW })).toMatchObject({ status: 401 });
    expect(await checkAccess(hdr("x.y.z"), cfg, { resolveKey, nowSec: NOW })).toMatchObject({ status: 403 });
    expect(await checkAccess(hdr("x.y.z"), cfg, { resolveKey, nowSec: NOW, invalidStatus: 401 })).toMatchObject({ status: 401 });
    expect(await checkAccess(hdr(await good()), cfg, { resolveKey, nowSec: NOW })).toMatchObject({ ok: true });
  });
});
