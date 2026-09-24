import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { handle, type Env } from "../src/index";
import { environmentOf, runStatus } from "../src/releases";

const TEAM = "ops-test.cloudflareaccess.com";
const AUD = "test-aud";
const cfgEnv: Env = { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

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
const good = () => jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600 });

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
});

const deps = () => ({ resolveKey: async (kid: string) => (kid === "k1" ? publicJwk : null) });
async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["cf-access-jwt-assertion"] = token;
  return handle(new Request(`https://ops.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), cfgEnv, deps());
}

describe("Access 门禁（fail-closed）", () => {
  it("Access 未配置 → 503", async () => {
    const res = await handle(new Request("https://ops.test/api/ops/incidents"), env);
    expect(res.status).toBe(503);
  });
  it("无 JWT → 401；签名错 / aud 错 / 过期 → 403", async () => {
    expect((await call("GET", "/api/ops/incidents")).status).toBe(401);
    const t = await good();
    expect((await call("GET", "/api/ops/incidents", undefined, t.slice(0, -4) + "AAAA")).status).toBe(403);
    expect((await call("GET", "/api/ops/incidents", undefined, await jwt({ aud: ["other"], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600 }))).status).toBe(403);
    expect((await call("GET", "/api/ops/incidents", undefined, await jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: 1 }))).status).toBe(403);
  });
  it("healthz 只报布尔", async () => {
    const body = await (await handle(new Request("https://ops.test/api/ops/healthz"), env)).json();
    expect(body).toEqual({ ok: true, access_configured: false, github_configured: false });
  });
});

describe("事故面板", () => {
  const hash = "a".repeat(64);
  it("新建 → 更新 → 关闭，时间线记录状态变化", async () => {
    const t = await good();
    const created = await call("POST", "/api/ops/incidents", { severity: "sev2", components: ["api"], affectedInstanceHashes: [hash], internalSummary: "API 5xx rate elevated after deploy" }, t);
    expect(created.status).toBe(201);
    const { incident } = (await created.json()) as { incident: { id: string } };
    const upd = await call("PATCH", `/api/ops/incidents/${incident.id}`, { status: "identified", severity: "sev1" }, t);
    expect(upd.status).toBe(200);
    const resolved = await call("POST", `/api/ops/incidents/${incident.id}/resolve`, undefined, t);
    const r = (await resolved.json()) as { incident: { status: string; resolvedAt?: string; timeline: { status: string }[] } };
    expect(r.incident.status).toBe("resolved");
    expect(r.incident.resolvedAt).toBeTruthy();
    expect(r.incident.timeline.map((e) => e.status)).toEqual(["investigating", "identified", "resolved"]);
    expect((await call("PATCH", `/api/ops/incidents/${incident.id}`, { severity: "sev3" }, t)).status).toBe(409);
    const list = (await (await call("GET", "/api/ops/incidents", undefined, t)).json()) as { incidents: unknown[] };
    expect(list.incidents.length).toBeGreaterThan(0);
  });
  it("拒绝客户数据：多余字段 / 非哈希实例引用 / 摘要含邮箱或长数字", async () => {
    const t = await good();
    const base = { severity: "sev3", components: ["web"], internalSummary: "login latency" };
    for (const bad of [
      { ...base, customerEmail: "x@example.com" },
      { ...base, affectedInstanceHashes: ["acme-corp"] },
      { ...base, internalSummary: "user bob@example.com cannot log in" },
      { ...base, internalSummary: "call 13800138000" },
      { ...base, internalSummary: "x".repeat(281) },
      { ...base, components: ["customer-acme"] },
    ]) {
      expect((await call("POST", "/api/ops/incidents", bad, t)).status).toBe(400);
    }
  });
});

describe("发布控制台（只读，现取现算）", () => {
  it("合并 Releases 与部署 workflow 运行，按时间倒序", async () => {
    const t = await good();
    const gh = async (path: string) => {
      if (path.includes("/releases")) return [{ tag_name: "v1.2.0", prerelease: false, draft: false, published_at: "2026-09-01T00:00:00Z", html_url: "https://r" }];
      return { workflow_runs: [{ head_sha: "a".repeat(40), status: "completed", conclusion: "success", created_at: "2026-09-02T00:00:00Z", html_url: "https://w", run_number: 7 }] };
    };
    const res = await handle(new Request("https://ops.test/api/ops/releases", { headers: { "cf-access-jwt-assertion": t } }), { ...cfgEnv, DEPLOY_WORKFLOWS: "deploy-coord-gateway.yml" }, { ...deps(), gh });
    const body = (await res.json()) as { releases: { source: string; environment: string; status: string }[] };
    expect(body.releases.map((r) => [r.source, r.environment, r.status])).toEqual([["deploy", "coord-gateway", "success"], ["release", "all", "published"]]);
  });
  it("未配置 GitHub token → 503", async () => {
    expect((await call("GET", "/api/ops/releases", undefined, await good())).status).toBe(503);
  });
  it("状态与环境映射", () => {
    expect(environmentOf("deploy-cn-production.yml")).toBe("cn-production");
    expect(runStatus({ status: "in_progress", conclusion: null })).toBe("in_progress");
    expect(runStatus({ status: "completed", conclusion: "skipped" })).toBe("unknown");
  });
});
