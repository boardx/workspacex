// @global-scope-fixture table:credit_packages: f04-order- package fixtures only.
// @global-scope-fixture table:billing_orders: created_by f04-order- fixtures only.
// @global-scope-fixture table:credentials: f04-order- principal fixtures only.
// @global-scope-fixture table:platform_admins: f04-order- grant fixtures only.
import "reflect-metadata";
import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { vi } from "vitest";
import { BillingModule } from "../../src/billing.module";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { toOrgId } from "../../src/domain/org-id";

export const user = "f04-order-user", other = "f04-order-other";
export const org = toOrgId("f04-order-org"), otherOrg = toOrgId("f04-order-other-org");
export type Mode = "success" | "non2xx" | "bad-signature" | "wrong-rsa" | "tampered" | "missing-signature" | "missing-nonce" | "missing-time" | "stale" | "unknown-key" | "missing-qr" | "bad-qr" | "malformed" | "redirect" | "oversize" | "timeout-headers" | "timeout-body";
export async function orderFixture() {
  ensureDatabase(); await migrateOnce();
  const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const state = { mode: "success" as Mode, calls: 0, signedRequests: 0, requests: [] as Record<string, unknown>[], onRequest: null as null | (() => Promise<void>) };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8"); state.calls++;
    const auth = req.headers.authorization ?? "";
    const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1];
    const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1];
    const signature = /signature="([^"]+)"/.exec(auth)?.[1];
    if (nonce && timestamp && signature && verify("RSA-SHA256", Buffer.from(`POST\n/v3/pay/transactions/native\n${timestamp}\n${nonce}\n${body}\n`), merchant.publicKey, Buffer.from(signature, "base64"))) state.signedRequests++;
    state.requests.push(JSON.parse(body) as Record<string, unknown>);
    await state.onRequest?.();
    if (state.mode === "timeout-headers") return;
    const payload = state.mode === "malformed" ? "not-json" : JSON.stringify(state.mode === "missing-qr" ? {} : { code_url: state.mode === "bad-qr" ? "https://evil.example/qr" : "weixin://wxpay/bizpayurl?pr=f04fixture", ...(state.mode === "oversize" ? { padding: "x".repeat(65536) } : {}) });
    const ts = String(Math.floor(Date.now() / 1000) - (state.mode === "stale" ? 3600 : 0));
    const responseNonce = randomBytes(16).toString("hex");
    const responseSignature = sign("RSA-SHA256", Buffer.from(`${ts}\n${responseNonce}\n${payload}\n`), state.mode === "wrong-rsa" ? merchant.privateKey : platform.privateKey).toString("base64");
    if (state.mode !== "missing-time") res.setHeader("Wechatpay-Timestamp", ts);
    if (state.mode !== "missing-nonce") res.setHeader("Wechatpay-Nonce", responseNonce);
    res.setHeader("Wechatpay-Serial", state.mode === "unknown-key" ? "PUB_KEY_ID_unknown" : "PUB_KEY_ID_f04");
    if (state.mode !== "missing-signature") res.setHeader("Wechatpay-Signature", state.mode === "bad-signature" ? "WECHATPAY/SIGNTEST/invalid" : responseSignature);
    res.statusCode = state.mode === "non2xx" ? 500 : state.mode === "redirect" ? 302 : 200;
    if (state.mode === "redirect") res.setHeader("Location", "https://evil.example");
    if (state.mode === "timeout-body") { res.flushHeaders(); res.write("{"); return; }
    res.end(state.mode === "tampered" ? `${payload} ` : payload);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("stub listener absent");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.mch.weixin.qq.com") {
      if (url.pathname !== "/v3/pay/transactions/native") throw new Error("unexpected merchant operation");
      return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
    }
    return nativeFetch(input, init);
  });
  const env: Record<string, string> = {
    WECHAT_PAY_APP_ID: "wx-f04-fixture", WECHAT_PAY_MCH_ID: "1900000001", WECHAT_PAY_API_V3_KEY: randomBytes(16).toString("hex"),
    WECHAT_PAY_MCH_SERIAL_NO: "ABC123", WECHAT_PAY_PLATFORM_KEY_ID: "PUB_KEY_ID_f04",
    WECHAT_PAY_PRIVATE_KEY: merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
    WECHAT_PAY_NOTIFY_URL: "https://billing.example.test/api/billing/webhooks/wechat",
  };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let app: NestExpressApplication | undefined;
  async function release() {
    try {
      if (app) { try { await app.close(); } finally { await app.get<DatabasePort>(DATABASE_PORT).close(); } }
    } finally {
      try { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
      finally { vi.unstubAllGlobals(); }
    }
  }
  try {
    app = await NestFactory.create<NestExpressApplication>({ module: class OrderHttpFixture {}, imports: [BillingModule], providers: [
      { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Readonly<Record<string, string | string[] | undefined>>) => {
        const id = headers.authorization === "Bearer f04-user" ? user : headers.authorization === "Bearer f04-other" ? other : null;
        return id ? { userId: id, orgId: org } : null;
      } } }, { provide: APP_GUARD, useClass: PrincipalGuard },
    ] }, { logger: false, abortOnError: false });
    await app.listen(0, "127.0.0.1");
  } catch (error) { await release(); throw error; } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  if (!app) throw new Error("HTTP fixture did not initialize");
  const base = await app.getUrl();
  const cleanup = () => asOwner(async c => {
    await c.query("DELETE FROM billing_orders WHERE created_by LIKE 'f04-order-%'");
    await c.query("DELETE FROM credit_packages WHERE package_id LIKE 'f04-order-%'");
    await c.query("DELETE FROM org_billing_settings WHERE org_id IN ($1,$2)", [org, otherOrg]);
    await c.query("DELETE FROM organizations WHERE id IN ($1,$2,$3)", [org, otherOrg, user]);
    await c.query("DELETE FROM platform_admins WHERE user_id IN ($1,$2)", [user, other]);
    await c.query("DELETE FROM credentials WHERE user_id IN ($1,$2)", [user, other]);
  });
  return {
    app, state, cleanup,
    async reset() {
      await cleanup(); state.mode = "success"; state.calls = 0; state.signedRequests = 0; state.requests = []; state.onRequest = null;
      await asOwner(async c => {
        await c.query("INSERT INTO organizations(id,name,kind) VALUES($1,'F04 A','organization'),($2,'F04 B','organization')", [org, otherOrg]);
        await c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin'),($3,$2,'consultant'),($3,$4,'admin')", [user, org, other, otherOrg]);
        await c.query("INSERT INTO credit_packages(package_id,region,currency,amount_fen,base_credits,bonus_credits,bonus_rate,total_credits,owner_type,sort_order) VALUES('f04-order-basic','cn','CNY',9900,1200,120,0.1,1320,'both',-100)");
      });
    },
    request(path: string, body?: Record<string, unknown>, token = "f04-user") {
      return nativeFetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    },
    create(extra: Record<string, unknown> = {}, token = "f04-user") { return this.request("/billing/orders", { ownerType: "user", packageId: "f04-order-basic", provider: "wechat", ...extra }, token); },
    async close() {
      try { await cleanup(); } finally { await release(); }
    },
  };
}
