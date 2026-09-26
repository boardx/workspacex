// 真 workerd：上报入口 → 每实例 DO → 车队 DO → Access 后的投影 / 视图 / 重建。
import { InstanceTelemetryReport } from "@repo/contracts/instance-telemetry";
import { SELF, env, fetchMock, runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FleetProjection, StoredReport } from "../src/fleet";
import { RATE_LIMIT_PER_HOUR } from "../src/fleet";
import { makeReport } from "./helpers";

const BASE = "https://telemetry.test";
const TEAM = "test-team.cloudflareaccess.com";

let signingKey: CryptoKey;
const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessJwt(over: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const p = b64url(
    JSON.stringify({ aud: ["test-aud"], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600, ...over }),
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  signingKey = pair.privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get(`https://${TEAM}`)
    .intercept({ path: "/cdn-cgi/access/certs" })
    .reply(200, JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] }), {
      headers: { "content-type": "application/json" },
    })
    .persist();
});
afterAll(() => fetchMock.deactivate());

function post(body: unknown, secret: string | null, raw?: string): Promise<Response> {
  return SELF.fetch(`${BASE}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: raw ?? JSON.stringify(body),
  });
}

async function getFleet(): Promise<FleetProjection> {
  const r = await SELF.fetch(`${BASE}/api/fleet`, { headers: { "cf-access-jwt-assertion": await accessJwt() } });
  expect(r.status).toBe(200);
  return (await r.json()) as FleetProjection;
}

describe("上报入口", () => {
  it("合法上报 202，并进入车队投影", async () => {
    const { secret, report } = await makeReport({ seed: "w1", productVersion: "2.0.0" });
    expect((await post(report, secret)).status).toBe(202);
    const p = await getFleet();
    expect(p.instances.find((i) => i.instanceId === report.instanceId)).toMatchObject({
      productVersion: "2.0.0",
      health: "healthy",
      overdue: false,
    });
  });

  it("不合契约 422，错误响应只回路径、不回显原值", async () => {
    const { secret, report } = await makeReport({ seed: "w2" });
    const r = await post({ ...report, note: "SECRET-SENTENCE" }, secret);
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain("SECRET-SENTENCE");
    expect((await post(null, secret, "{not json")).status).toBe(400);
    expect((await post({ ...report, productVersion: "SECRET-SENTENCE" }, secret)).status).toBe(422);
  });

  it("没有或错误的安装密钥 401；拿别人的 instanceId 冒报 401", async () => {
    const { report } = await makeReport({ seed: "w3" });
    const other = await makeReport({ seed: "w3-other" });
    expect((await post(report, null)).status).toBe(401);
    expect((await post(report, other.secret)).status).toBe(401);
  });

  it("非 JSON、超大体 → 4xx；GET 405", async () => {
    const r1 = await SELF.fetch(`${BASE}/v1/report`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(r1.status).toBe(415);
    expect((await post(null, "x", "[" + "1,".repeat(200_000) + "1]")).status).toBe(413);
    expect((await SELF.fetch(`${BASE}/v1/report`)).status).toBe(405);
  });

  it(`按 instanceId 限流：第 ${RATE_LIMIT_PER_HOUR + 1} 次 429，别的实例不受影响`, async () => {
    const { secret, report } = await makeReport({ seed: "w4" });
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) expect((await post(report, secret)).status).toBe(202);
    expect((await post(report, secret)).status).toBe(429);
    const other = await makeReport({ seed: "w4-other" });
    expect((await post(other.report, other.secret)).status).toBe(202);
  });
});

/** 递归比对：stored 的每个键都必须在 contract parse 的输出里出现，值逐字相等。 */
function assertOnlyContractFields(stored: unknown, reference: unknown, path = "report"): void {
  if (stored && typeof stored === "object") {
    expect(reference && typeof reference === "object", path).toBe(true);
    for (const k of Object.keys(stored)) {
      expect(Object.prototype.hasOwnProperty.call(reference, k), `${path}.${k} 不在契约输出里`).toBe(true);
      assertOnlyContractFields((stored as Record<string, unknown>)[k], (reference as Record<string, unknown>)[k], `${path}.${k}`);
    }
  } else {
    expect(stored, path).toEqual(reference);
  }
}

describe("落盘只有契约字段", () => {
  it("每实例 DO 的全部存储键 + 形状；不含密钥或请求头", async () => {
    const { secret, report } = await makeReport({ seed: "w5" });
    expect((await post(report, secret)).status).toBe(202);
    const stub = env.INSTANCE.get(env.INSTANCE.idFromName(report.instanceId));
    await runInDurableObject(stub, async (_inst, state) => {
      const all = await state.storage.list();
      expect([...all.keys()].sort()).toEqual(["accepts", "history", "latest"]);
      const accepts = all.get("accepts") as unknown[];
      expect(accepts.every((t) => typeof t === "number")).toBe(true);
      const records = [all.get("latest") as StoredReport, ...(all.get("history") as StoredReport[])];
      for (const rec of records) {
        expect(Object.keys(rec).sort()).toEqual(["receivedAt", "report"]);
        expect(typeof rec.receivedAt).toBe("number");
        const reference = InstanceTelemetryReport.parse(rec.report);
        assertOnlyContractFields(rec.report, reference);
      }
      expect(JSON.stringify([...all.values()])).not.toContain(secret);
    });
  });

  it("车队 DO 只存由上报推出的摘要", async () => {
    const stub = env.FLEET.get(env.FLEET.idFromName("fleet"));
    await runInDurableObject(stub, async (_f, state) => {
      const all = await state.storage.list();
      expect(all.size).toBeGreaterThan(0);
      for (const [k, v] of all) {
        expect(k.startsWith("s:")).toBe(true);
        expect(Object.keys(v as object).sort()).toEqual(["edition", "health", "instanceId", "periodEnd", "productVersion", "receivedAt"]);
      }
    });
  });
});

describe("Access 门与投影", () => {
  it("无 JWT / 错 aud / 过期 / 错签 → 401", async () => {
    expect((await SELF.fetch(`${BASE}/api/fleet`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/fleet`)).status).toBe(401);
    for (const bad of [await accessJwt({ aud: ["other"] }), await accessJwt({ exp: 1 }), await accessJwt({ iss: "https://evil" })]) {
      expect((await SELF.fetch(`${BASE}/api/fleet`, { headers: { "cf-access-jwt-assertion": bad } })).status).toBe(401);
    }
    const good = await accessJwt();
    const tampered = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await SELF.fetch(`${BASE}/api/fleet`, { headers: { "cf-access-jwt-assertion": tampered } })).status).toBe(401);
  });

  it("视图是只读 HTML", async () => {
    const r = await SELF.fetch(`${BASE}/fleet`, { headers: { "cf-access-jwt-assertion": await accessJwt() } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("api/fleet");
  });

  it("投影可重建：清空车队索引 → rebuild → 与之前相同", async () => {
    const before = await getFleet();
    expect(before.total).toBeGreaterThan(0);
    const stub = env.FLEET.get(env.FLEET.idFromName("fleet"));
    // 模拟边缘丢了摘要值（保留键以便枚举，值被破坏）
    await runInDurableObject(stub, async (_f, state) => {
      const all = await state.storage.list();
      for (const k of all.keys()) await state.storage.put(k, { instanceId: k.slice(2), productVersion: "0.0.0", edition: "cloud", health: "down", periodEnd: "", receivedAt: 0 });
    });
    const r = await SELF.fetch(`${BASE}/api/fleet/rebuild`, { method: "POST", headers: { "cf-access-jwt-assertion": await accessJwt() } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { rebuilt: number }).rebuilt).toBe(before.total);
    const after = await getFleet();
    expect(after.instances).toEqual(before.instances);
    expect(after.byVersion).toEqual(before.byVersion);
    expect(after.health).toEqual(before.health);
  });
});

describe("Access 未配置", () => {
  it("团队域名或 AUD 为空 → 503 fail-closed，不是放行", async () => {
    const { verifyAccess } = await import("../src/access");
    const req = new Request(`${BASE}/api/fleet`, { headers: { "cf-access-jwt-assertion": await accessJwt() } });
    expect(await verifyAccess(req, {})).toEqual({ ok: false, status: 503 });
    expect(await verifyAccess(req, { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: " " })).toEqual({ ok: false, status: 503 });
  });
});
