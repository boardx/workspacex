// D7：devportal 的 Access 回退通道走共享校验器 @repo/coord-access，且缺配置 fail-closed。
// 反例覆盖：未配 AUD（旧 #769 行为是「只警告照样放行」）、占位值、aud 不符、伪造签名。
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { KeyResolver } from "@repo/coord-access";
import { accessUser } from "../lib/access";

const TEAM = "team.cloudflareaccess.com";
const AUD = "expected-aud";
let priv: CryptoKey;
let resolveKey: KeyResolver;
const b64url = (b: Uint8Array | string) => Buffer.from(typeof b === "string" ? new TextEncoder().encode(b) : b).toString("base64url");

async function token(over: Record<string, unknown> = {}, key = priv) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const p = b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600, email: "u@x.com", ...over }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}
const gen = () =>
  crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
const hdr = (t: string) => new Headers({ "cf-access-jwt-assertion": t });

beforeAll(async () => {
  const kp = await gen();
  priv = kp.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  resolveKey = async (kid) => (kid === "k1" ? jwk : null);
});
afterEach(() => {
  delete process.env["CF_ACCESS_AUD"];
  delete process.env["CF_ACCESS_TEAM_DOMAIN"];
});
const configure = (aud = AUD) => {
  process.env["CF_ACCESS_TEAM_DOMAIN"] = `https://${TEAM}`;
  process.env["CF_ACCESS_AUD"] = aud;
};

describe("accessUser（fail-closed）", () => {
  it("无头 → null", async () => {
    configure();
    expect(await accessUser(new Headers(), resolveKey)).toBeNull();
  });
  it("配置齐全 + 有效 token → 身份", async () => {
    configure();
    expect(await accessUser(hdr(await token()), resolveKey)).toEqual({ email: "u@x.com" });
  });
  it("反例：未配 CF_ACCESS_AUD → 有效 token 也被拒（旧行为是放行）", async () => {
    process.env["CF_ACCESS_TEAM_DOMAIN"] = `https://${TEAM}`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await accessUser(hdr(await token()), resolveKey)).toBeNull();
  });
  it("反例：AUD 是占位值 / 团队域名缺失 → 拒", async () => {
    configure("__SET_CF_ACCESS_AUD__");
    expect(await accessUser(hdr(await token()), resolveKey)).toBeNull();
    process.env["CF_ACCESS_AUD"] = AUD;
    delete process.env["CF_ACCESS_TEAM_DOMAIN"];
    expect(await accessUser(hdr(await token()), resolveKey)).toBeNull();
  });
  it("反例：aud 不符 / 伪造签名 / 无 email → 拒", async () => {
    configure();
    expect(await accessUser(hdr(await token({ aud: ["other-app"] })), resolveKey)).toBeNull();
    expect(await accessUser(hdr(await token({}, (await gen()).privateKey)), resolveKey)).toBeNull();
    expect(await accessUser(hdr(await token({ email: undefined })), resolveKey)).toBeNull();
  });
});
