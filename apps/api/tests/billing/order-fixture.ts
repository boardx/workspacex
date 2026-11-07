import {AiUsageController} from "../../src/interface/controllers/ai-usage.controller";
import {AI_USAGE_REPOSITORY} from "../../src/application/auth/ai-usage-ports";
import {PgAiUsageRepository} from "../../src/infrastructure/auth/pg-ai-usage-repository";
import {IdentityPersistenceModule} from "../../src/infrastructure/identity/identity-persistence.module";
import { LOGGER_PORT } from "../../src/application/ports/logger.port";
// @global-scope-fixture table:credit_packages: f04-order- package fixtures only.
import "reflect-metadata";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { traceMiddleware } from "../../src/interface/middleware/trace";
import { ConsoleLogger } from "../../src/infrastructure/logging/console-logger";
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
export interface BillingFixtureOptions { platformVerification?: boolean; billingEnv?: Readonly<Record<string,string>> }
export async function orderFixture(beforeListen?: (app: NestExpressApplication) => void, options: BillingFixtureOptions = {}) {
  const platformVerification = options.platformVerification !== false;
  ensureDatabase(); await migrateOnce();
  const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const state = { paidMonthly: new Map<string, Record<string, unknown>>(), mode: "success" as Mode, calls: 0, signedRequests: 0, requests: [] as Record<string, unknown>[], requestHeaders: [] as Record<string, unknown>[], closeMode: "success" as "success" | "paid" | "failed" | "closed", closeRequests: 0, onClose: null as null | (() => Promise<void>), onRequest: null as null | (() => Promise<void>) };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8"); const isClose = req.url?.endsWith("/close"); if (!isClose) state.calls++;
    state.requestHeaders.push({ ...req.headers });
    if (req.headers["accept-language"] !== "zh-CN" || req.headers["wechatpay-serial"] !== (platformVerification ? "PUB_KEY_ID_f04" : undefined)) {
      res.statusCode = 406; res.end(JSON.stringify({ code: "PARAM_ERROR", message: "Unsupported merchant protocol headers" })); return;
    }
    const auth = req.headers.authorization ?? "";
    const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1];
    const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1];
    const signature = /signature="([^"]+)"/.exec(auth)?.[1];
    if (nonce && timestamp && signature && verify("RSA-SHA256", Buffer.from(`${req.method}\n${req.url}\n${timestamp}\n${nonce}\n${body}\n`), merchant.publicKey, Buffer.from(signature, "base64"))) state.signedRequests++;
    if (req.method === "GET") {
      if(!nonce||!timestamp||!signature||!verify("RSA-SHA256",Buffer.from(`GET\n${req.url}\n${timestamp}\n${nonce}\n${body}\n`),merchant.publicKey,Buffer.from(signature,"base64"))){res.statusCode=401;res.end();return;}
      const path=new URL(req.url!,"http://fixture").pathname;
      const orderNo=path.split("/").at(-1)!;
      const payment=state.paidMonthly.get(orderNo);
      const payload=JSON.stringify(payment??{code:"ORDER_NOT_EXIST",message:"not created"});
      const ts=String(Math.floor(Date.now()/1000)),responseNonce=randomBytes(16).toString("hex");
      res.setHeader("Wechatpay-Timestamp",ts);res.setHeader("Wechatpay-Nonce",responseNonce);res.setHeader("Wechatpay-Serial","PUB_KEY_ID_f04");
      res.setHeader("Wechatpay-Signature",sign("RSA-SHA256",Buffer.from(`${ts}\n${responseNonce}\n${payload}\n`),platform.privateKey).toString("base64"));
      res.statusCode=payment?200:404;res.end(payload);return;
    }
    if (isClose) {
      state.closeRequests++; await state.onClose?.();
      const payload = state.closeMode === "success" ? "" : JSON.stringify({code:state.closeMode === "paid" ? "ORDERPAID" : state.closeMode === "closed" ? "ORDERCLOSED" : "SYSTEM_ERROR"});
      const ts=String(Math.floor(Date.now()/1000)), responseNonce=randomBytes(16).toString("hex");
      res.setHeader("Wechatpay-Timestamp",ts);res.setHeader("Wechatpay-Nonce",responseNonce);res.setHeader("Wechatpay-Serial","PUB_KEY_ID_f04");
      res.setHeader("Wechatpay-Signature",state.mode === "bad-signature" ? "invalid-signature" : sign("RSA-SHA256",Buffer.from(`${ts}\n${responseNonce}\n${payload}\n`),platform.privateKey).toString("base64"));
      res.statusCode=state.closeMode === "success" ? 204 : 400;res.end(payload);return;
    }
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
  let requestLogger = new ConsoleLogger(true);
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
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("stub listener absent");
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.mch.weixin.qq.com") {
        if (url.pathname !== "/v3/pay/transactions/native" && !/^\/v3\/pay\/transactions\/out-trade-no\/b[gm][A-Za-z0-9]+(?:\/close)?$/.test(url.pathname)) throw new Error("unexpected merchant operation");
        return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
      }
      return nativeFetch(input, init);
    });
    const env: Record<string, string> = {
      KERNEL_KEEP_LOGS: "1", BILLING_DEPLOYMENT:"cn", BILLING_WECHAT_ENABLED:"true",
      WECHAT_PAY_APP_ID: "wx-f04-fixture", WECHAT_PAY_MCH_ID: "1900000001", WECHAT_PAY_API_V3_KEY: randomBytes(16).toString("hex"),
      WECHAT_PAY_MCH_SERIAL_NO: "ABC123", WECHAT_PAY_PLATFORM_KEY_ID: platformVerification ? "PUB_KEY_ID_f04" : "",
      WECHAT_PAY_PRIVATE_KEY: merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      WECHAT_PAY_PLATFORM_PUBLIC_KEY: platformVerification ? platform.publicKey.export({ type: "spki", format: "pem" }).toString() : "",
      WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: "",
      WECHAT_PAY_NOTIFY_URL: "https://billing.example.test/api/billing/webhooks/wechat",
      ...options.billingEnv,
    };
    const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    try {
      app = await NestFactory.create<NestExpressApplication>({ module: class OrderHttpFixture {}, imports: [BillingModule,IdentityPersistenceModule], controllers:[AiUsageController], providers: [
 {provide:AI_USAGE_REPOSITORY,useFactory:(db:DatabasePort)=>new PgAiUsageRepository(db),inject:[DATABASE_PORT]},
        { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Readonly<Record<string, string | string[] | undefined>>) => {
          const id = headers.authorization === "Bearer f04-user" ? user : headers.authorization === "Bearer f04-other" ? other : null;
          return id ? { userId: id, orgId: org } : null;
        } } }, { provide: APP_GUARD, useClass: PrincipalGuard },
      ] }, { logger: false, abortOnError: false });
      beforeListen?.(app);
      requestLogger = app.get<ConsoleLogger>(LOGGER_PORT);
      app.use(traceMiddleware);
      app.useGlobalFilters(new AllExceptionsFilter(requestLogger, {
        record: async () => undefined,
        list: async () => ({ items: [], hasMore: false }),
        getLifecycle: async () => null,
        updateLifecycle: async () => null,
      }));
      await app.listen(0, "127.0.0.1");
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    if (!app) throw new Error("HTTP fixture did not initialize");
    const base = await app.getUrl();
    const cleanup = () => asOwner(async c => {
      await c.query("DELETE FROM billing_payment_conflicts WHERE user_id IN ($1,$2)",[user,other]);
      await c.query("DELETE FROM billing_monthly_orders WHERE user_id IN ($1,$2)",[user,other]);
      await c.query("DELETE FROM billing_subscriptions WHERE user_id IN ($1,$2)",[user,other]);
      await c.query("DELETE FROM billing_orders WHERE created_by LIKE 'f04-order-%'");
      await c.query("DELETE FROM credit_packages WHERE package_id LIKE 'f04-order-%'");
      await c.query("DELETE FROM org_billing_settings WHERE org_id IN ($1,$2)", [org, otherOrg]);
      await c.query("DELETE FROM organizations WHERE id IN ($1,$2,$3)", [org, otherOrg, user]);
      await c.query("DELETE FROM platform_admins WHERE user_id IN ($1,$2)", [user, other]);
      await c.query("DELETE FROM credentials WHERE user_id IN ($1,$2)", [user, other]);
    });
    return {
      app, state, cleanup, base, requestLogger,
      crypto: { platformPrivateKey: platform.privateKey, apiV3Key: env.WECHAT_PAY_API_V3_KEY! },
      async reset() {
        await cleanup(); state.paidMonthly.clear(); state.mode = "success"; state.closeMode = "success"; state.closeRequests = 0; state.onClose = null; state.calls = 0; state.signedRequests = 0; state.requests = []; state.requestHeaders = []; state.onRequest = null;
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
      async close(options?: { preserveData?: boolean }) {
        try { if (!options?.preserveData) await cleanup(); } finally { await release(); }
      },
    };
  } catch (error) { await release(); throw error; }
}
