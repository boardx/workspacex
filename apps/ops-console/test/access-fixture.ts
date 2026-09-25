/** 测试用 Cloudflare Access JWT 夹具：本地生成 RS256 密钥对，签出合法 token。 */
export function accessFixture() {
  const TEAM = "ops-test.cloudflareaccess.com";
  const AUD = "test-aud";
  let privateKey: CryptoKey;
  let publicJwk: JsonWebKey;
  const b64url = (b: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  async function jwt(payload: Record<string, unknown>) {
    const head = enc({ alg: "RS256", kid: "k1" });
    const body = enc(payload);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  }
  return {
    TEAM, AUD, jwt,
    good: () => jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600 }),
    deps: () => ({ resolveKey: async (kid: string) => (kid === "k1" ? publicJwk : null) }),
    async init() {
      const pair = (await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
      )) as CryptoKeyPair;
      privateKey = pair.privateKey;
      publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
    },
  };
}
