// @global-scope-fixture table:billing_monthly_orders: f08-sub-* exact prefix cleanup; new one-time purchase orders.
// @global-scope-fixture table:billing_purchase_intents: runtime-issued f08-sub-* intents; cleanup() deletes only this fixture user prefix; INSERT text below classifies instance-local faults.
// @global-scope-fixture table:billing_subscriptions: f08-sub-* user prefix; cleanup deletes only owned fixtures.
import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {BillingStripeWebhookService} from "../../src/application/billing/billing-stripe-webhook-service";
import { BillingModule } from "../../src/billing.module";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { DATABASE_PORT, type DatabasePort, type TenantSession } from "../../src/application/ports/database.port";
import { LOGGER_PORT, type LoggerPort } from "../../src/application/ports/logger.port";
import { traceMiddleware } from "../../src/interface/middleware/trace";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { asOwner, asApp, ensureDatabase, migrateOnce } from "../support/db";
const STRIPE_API_VERSION = "2025-09-30.clover";
const user = "f08-sub-user", other = "f08-sub-other", org = toOrgId("f08-sub-org");
let app: NestExpressApplication, server: Server, base: string;
const diagnostics: { msg: string; fields: Record<string, unknown> }[] = [];
let sinkFails = false;
let databaseFault: "read" | "insert" | "intent-count" | "unknown" | null = null;
const privateFixtureValues: string[] = [];
const sessions=new Map<string,Record<string,unknown>>();
const state = { mode: "ok", calls: [] as { body: URLSearchParams; version: string | undefined }[] };
async function request(path: string, who: string = user, requestOrg = "f08-sub-org") {
  return fetch(`${base}/billing/subscription${path}`, { ...(path.startsWith("/upgrade-link") ? { method:"POST", body:"{}" } : {}), headers: who ? { authorization: `Bearer ${who}`, "x-test-org": requestOrg, "content-type":"application/json" } : {} });
}
async function seed(status: string, uncertain = false, customer: string | null = "cus_f08trusted") {
  await asOwner(c => c.query(`INSERT INTO billing_subscriptions
    (user_id,customer_ref,subscription_ref,status,plan_ref,current_period_end,synchronization_uncertain)
    VALUES ($1,$2,'sub_f08trusted',$3,'price_f08','2030-01-01T00:00:00Z',$4)`, [user, customer, status, uncertain]));
}
async function cleanup() {
  await asOwner(async c => {
    await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_f08monthly%'");
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'f08-sub-%')");
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'f08-sub-%')");
    await c.query("DELETE FROM credit_wallets WHERE owner_id LIKE 'f08-sub-%'");
    await c.query("DELETE FROM billing_monthly_orders WHERE user_id LIKE 'f08-sub-%'");
    await c.query("DELETE FROM billing_purchase_intents WHERE user_id LIKE 'f08-sub-%'");
    await c.query("DELETE FROM billing_subscriptions WHERE user_id LIKE 'f08-sub-%'");
  });
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  for (const [key, value] of Object.entries({ STRIPE_SECRET_KEY: `sk_test_${randomBytes(16).toString("hex")}`, STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString("hex")}`,
    STRIPE_RETURN_URL: "https://app.example.test/billing?subscription_return=1", STRIPE_PAYMENT_LINK: "https://buy.stripe.com/f08?client_reference_id=untrusted&prefilled_email=untrusted", STRIPE_MANAGEMENT_PORTAL: "https://billing.stripe.com/p/login/f08" })) { vi.stubEnv(key, value); if (key.includes("SECRET")) privateFixtureValues.push(value); }
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    state.calls.push({ body: new URLSearchParams(Buffer.concat(chunks).toString()), version: req.headers["stripe-version"] as string | undefined });
    if (state.mode === "headers-timeout") return;
    if (state.mode === "oversize") { res.end("x".repeat(65537)); return; }
    if (state.mode === "timeout") { res.flushHeaders(); res.write("{"); return; }
    if (state.mode === "redirect") { res.writeHead(302, { location: "https://evil.invalid" }); res.end(); return; }
    if(req.url?.startsWith("/v1/checkout/sessions")&&["ok","lost-create-response"].includes(state.mode)) {
      const body=state.calls.at(-1)!.body, id=body.get("client_reference_id");
      if(req.method==="POST") {
        const session={id:`cs_f08_${id!.replaceAll("-","")}`,object:"checkout.session",mode:"payment",status:"open",livemode:false,amount_total:18000,currency:"cny",client_reference_id:id,metadata:{product:"monthly_pass_v1",order_ref:id},url:`https://checkout.stripe.com/c/pay/${id}`};
        sessions.set(session.id,session);if(state.mode==="lost-create-response"){state.mode="ok";req.socket.destroy();return;}res.end(JSON.stringify(session));return;
      }
      res.end(JSON.stringify(sessions.get(req.url.split("/").at(-1)!)));return;
    }
    res.statusCode = state.mode === "error" ? 500 : 200;
    res.end(state.mode === "malformed" ? "not json" : JSON.stringify({ object: "billing_portal.session", customer: state.mode === "wrong-customer" ? "cus_other" : "cus_f08trusted", url: state.mode === "bad-url" ? "https://evil.invalid/portal" : "https://billing.stripe.com/p/session/f08" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("listener missing");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return nativeFetch(url.origin === "https://api.stripe.com" ? `http://127.0.0.1:${address.port}${url.pathname}` : input, init);
  });
  app = await NestFactory.create<NestExpressApplication>({ module: class SubscriptionTestRoot {}, imports: [BillingModule], providers: [
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string,string>) => headers.authorization?.startsWith("Bearer f08-sub-") ? { userId: headers.authorization.slice(7), orgId: headers["x-test-org"] === "f08-sub-other-org" ? toOrgId("f08-sub-other-org") : org } : null } },
    { provide: APP_GUARD, useClass: PrincipalGuard },
  ] }, { logger: false, abortOnError: false });
  // Instance-local fault adapter: only this application's pool and fixture user are affected.
  // Error modes execute actual PostgreSQL arithmetic in the transaction, never alter shared grants.
  const database = app.get<DatabasePort>(DATABASE_PORT);
  const withTenant = database.withTenant.bind(database);
  const faultSession = (session: TenantSession): TenantSession => ({
    async query<R>(sql: string, params?: readonly unknown[]) {
      const owned = params?.includes(user) === true;
      const reading = owned && sql.includes("FROM billing_subscriptions WHERE user_id=$1");
      const inserting = owned && sql.includes("INSERT INTO billing_monthly_orders");
      const counting = owned && sql.includes("FROM billing_monthly_orders WHERE user_id=$1 AND state='pending'");
      if ((databaseFault === "read" && reading) || (databaseFault === "insert" && inserting) || (databaseFault === "intent-count" && counting)) await session.query("SELECT 1/0");
      const result = await session.query<R>(sql, params);
      return databaseFault === "unknown" && reading ? { rows: result.rows.map(row => ({ ...row, status: "future_unknown" })) } : result;
    },
  });
  const withFault: DatabasePort["withTenant"] = <T>(orgId: OrgId, run: (s: TenantSession) => Promise<T>) => withTenant(orgId, session => run(faultSession(session)));
  vi.spyOn(database, "withTenant").mockImplementation(withFault);
  vi.spyOn(app.get<LoggerPort>(LOGGER_PORT), "error").mockImplementation((msg, fields) => {
    diagnostics.push({ msg, fields }); if (sinkFails) throw Error("diagnostic sink unavailable");
  });
  app.use(traceMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter({ info() {}, error() {} } as never, { record: async () => {} } as never));
  await app.listen(0, "127.0.0.1"); const local = app.getHttpServer().address(); if (!local || typeof local === "string") throw Error("listener missing"); base = `http://127.0.0.1:${local.port}`;
}, 120_000);
beforeEach(async () => { await cleanup(); state.calls = []; state.mode = "ok"; diagnostics.length = 0; sinkFails = false; databaseFault = null; });
afterAll(async () => {
  if (app) { await app.close(); await app.get<DatabasePort>(DATABASE_PORT).close(); }
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
describe("F08 real subscription HTTP/PG", () => {
  it("requires authentication for all three read/link operations", async () => {
    for (const path of ["", "/upgrade-link", "/management-link"]) expect((await request(path, "")).status).toBe(401);
  });
  it("only returns none for absent own data, never leaks another user's subscription", async () => {
    await seed("active");
    expect(await (await request("", other)).json()).toEqual({ status: "none", planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(await (await request("")).json()).toEqual({ status: "active", planRef: "price_f08", currentPeriodEnd: "2030-01-01T00:00:00.000Z", cancelAtPeriodEnd: false,creditGrant:{status:"pending",grant:null} });
  });
  it.each(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"])("%s is readable but blocks repeat sale and uses trusted Portal customer", async status => {
    await seed(status);
    expect((await (await request("")).json()).status).toBe(status);
    const denied = await request("/upgrade-link"); expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "already_subscribed" });
    const result = await request("/management-link"); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ url: "https://billing.stripe.com/p/session/f08" });
    expect(state.calls).toHaveLength(1); expect(state.calls[0]!.body.get("customer")).toBe("cus_f08trusted"); expect(state.calls[0]!.version).toBe(STRIPE_API_VERSION);
    expect(state.calls[0]!.body.get("return_url")).toBe("https://app.example.test/billing?subscription_return=1&subscription_management_return=1");
  });
  it.each([null,"canceled","incomplete_expired"])("%s buys a fixed one-time month bound to the principal",async status=>{
    if(status)await seed(status);
    const response=await request("/upgrade-link");expect(response.status).toBe(201);
    const {url}=await response.json();expect(new URL(url).origin).toBe("https://checkout.stripe.com");
    const stored=await asOwner(c=>c.query("SELECT order_id,user_id,session_ref FROM billing_monthly_orders WHERE user_id=$1",[user]));
    expect(stored.rows).toHaveLength(1);expect(stored.rows[0].user_id).toBe(user);expect(url).toContain(stored.rows[0].order_id);
    expect(state.calls[0]!.body.get("mode")).toBe("payment");expect(state.calls[0]!.body.get("line_items[0][price_data][unit_amount]")).toBe("18000");
    expect((await asOwner(c=>c.query("SELECT 1 FROM billing_purchase_intents WHERE user_id=$1",[user]))).rows).toHaveLength(0);
  });
  async function pendingOrder(){
    const response=await request("/upgrade-link");expect(response.status).toBe(201);
    return (await asOwner(c=>c.query("SELECT order_id,session_ref FROM billing_monthly_orders WHERE user_id=$1 ORDER BY created_at DESC,order_id DESC LIMIT 1",[user]))).rows[0]!;
  }
  const markPaid=(order:{order_id:string;session_ref:string})=>{
    const session=sessions.get(order.session_ref)!;
    Object.assign(session,{status:"complete",payment_status:"paid",payment_intent:`pi_${order.order_id.replaceAll("-","")}`,url:null});return session;
  };
  async function monthlyEvent(order:{session_ref:string},eventId="evt_f08monthly_paid"){
    const body=Buffer.from(JSON.stringify({id:eventId,object:"event",type:"checkout.session.completed",data:{object:{id:order.session_ref,mode:"payment"}}}));
    const timestamp=Math.floor(Date.now()/1000),signature=createHmac("sha256",process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.`).update(body).digest("hex");
    return app.get(BillingStripeWebhookService).handle(body,`t=${timestamp},v1=${signature}`,"monthly-test");
  }
  it("recovers a delayed webhook on authenticated return and deduplicates later signed events",async()=>{
    const order=await pendingOrder();markPaid(order);
    expect(await (await request("")).json()).toMatchObject({status:"active",purchaseMode:"manual_monthly",creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:20000}}});
    expect((await monthlyEvent(order)).status).toBe(200);expect((await monthlyEvent(order,"evt_f08monthly_sibling")).status).toBe(200);
    expect((await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20000.00",total_granted:20000}]);
    expect((await request("/upgrade-link")).status).toBe(409);
  });
  it("accepts a signed paid checkout before the browser returns",async()=>{
    const order=await pendingOrder();markPaid(order);expect((await monthlyEvent(order)).status).toBe(200);
    expect((await (await request("")).json()).status).toBe("active");
  });
  it("does not grant money or new purchase after an authenticated mismatched amount",async()=>{
    const order=await pendingOrder(),session=markPaid(order);session.amount_total=17999;
    expect((await monthlyEvent(order)).status).toBe(500);expect((await request("")).status).toBe(503);
    expect((await asOwner(c=>c.query("SELECT 1 FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([]);
  });
  it("recovers an ambiguous creation response using the same durable order",async()=>{
    state.mode="lost-create-response";expect((await request("/upgrade-link")).status).toBe(503);
    const before=(await asOwner(c=>c.query("SELECT order_id FROM billing_monthly_orders WHERE user_id=$1",[user]))).rows[0]!;
    const order=await pendingOrder();expect(order.order_id).toBe(before.order_id);expect(sessions.size).toBeGreaterThan(0);
  });
  it("creates a new checkout only after Stripe authoritatively expires the previous one",async()=>{
    const order=await pendingOrder();Object.assign(sessions.get(order.session_ref)!,{status:"expired",url:null});
    expect((await (await request("")).json()).checkoutPending).toBe(false);
    expect((await pendingOrder()).order_id).not.toBe(order.order_id);
  });
  it("uncertain current state returns 503 for info and both links without changing the snapshot", async () => {
    await seed("active", true);
    for (const path of ["", "/upgrade-link", "/management-link"]) expect((await request(path)).status).toBe(503);
    expect(state.calls).toHaveLength(0);
    expect((await asOwner(c => c.query("SELECT status,synchronization_uncertain FROM billing_subscriptions WHERE user_id=$1", [user]))).rows[0]).toEqual({ status: "active", synchronization_uncertain: true });
  });
  it("missing customer binding never falls back to browser customer/email", async () => {
    await seed("active", false, null); expect((await request("/management-link?customer=cus_attacker")).status).toBe(400); expect((await request("/management-link")).status).toBe(503); expect(state.calls).toHaveLength(0);
  });
  it.each(["error", "malformed", "wrong-customer", "bad-url", "redirect", "timeout", "headers-timeout", "oversize"])("rejects unsafe provider response %s without mutating subscription", async mode => {
    await seed("active"); state.mode = mode;
    const response = await request("/management-link"); expect(response.status).toBe(503);
    const stage = mode === "error" ? "http" : ["redirect", "headers-timeout"].includes(mode) ? "request" : ["wrong-customer", "bad-url"].includes(mode) ? "validate" : "body";
    const reason = ["timeout", "headers-timeout"].includes(mode) ? "deadline_exceeded" : mode === "oversize" ? "response_too_large" : mode === "error" ? "upstream_http_error" : mode === "redirect" ? "request_failed" : "response_invalid";
    expect(diagnostics).toContainEqual({ msg: "billing_stripe_portal_failed", fields: { traceId: response.headers.get("x-trace-id"), err: { stage, reason,
      ...(["redirect", "headers-timeout"].includes(mode) ? {} : { status: mode === "error" ? 500 : 200 }),
    } } });
    expect((await asOwner(c => c.query("SELECT status FROM billing_subscriptions WHERE user_id=$1", [user]))).rows[0]?.status).toBe("active");
  }, 15000);
  it("boots with Stripe disabled and never creates intents or contacts provider", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const disabled = await NestFactory.create<NestExpressApplication>({ module: class DisabledRoot {}, imports: [BillingModule], providers: [
      { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async () => ({ userId: user, orgId: org }) } },
      { provide: APP_GUARD, useClass: PrincipalGuard },
    ] }, { logger: false, abortOnError: false });
    disabled.useGlobalFilters(new AllExceptionsFilter({ info() {}, error() {} } as never, { record: async () => {} } as never));
    try {
      await disabled.listen(0,"127.0.0.1"); const address = disabled.getHttpServer().address(); if (!address || typeof address === "string") throw Error("listener missing");
      for (const path of ["upgrade-link","management-link"]) {
        const response = await fetch(`http://127.0.0.1:${address.port}/billing/subscription/${path}`, path === "upgrade-link" ? {method:"POST",headers:{"content-type":"application/json"},body:"{}"}: {});
        expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "payment_provider_not_configured" });
      }
      expect(state.calls).toHaveLength(0);
      expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_purchase_intents WHERE user_id=$1",[user]))).rows[0]?.n).toBe(0);
    } finally { await disabled.close(); await disabled.get<DatabasePort>(DATABASE_PORT).close(); }
  });
  it("real database read failures return 503 for info and both links, never none or new intents", async () => {
    databaseFault = "read";
    try {
      for (const path of ["", "/upgrade-link", "/management-link"]) {
        const response = await request(path); expect(response.status).toBe(503);
        const body = await response.json(); expect(body).toMatchObject({ error: "dependency_unavailable" });
        expect(body).not.toHaveProperty("status"); expect(body).not.toHaveProperty("url");
      }
      expect(state.calls).toHaveLength(0);
      expect((await (await request("", other)).json()).status).toBe("none");
      expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_purchase_intents WHERE user_id=$1", [user]))).rows[0]?.n).toBe(0);
    } finally { databaseFault = null; }
  });
  it("a real intent insert failure returns 503 without returning a purchase URL", async () => {
    databaseFault = "insert";
    try {
      const response = await request("/upgrade-link"); expect(response.status).toBe(503);
      const body = await response.json(); expect(body).toMatchObject({ error: "dependency_unavailable" }); expect(body).not.toHaveProperty("url");
      expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_purchase_intents WHERE user_id=$1", [user]))).rows[0]?.n).toBe(0);
    } finally { databaseFault = null; }
  });
  it("correlates safe Portal and database failures with the HTTP trace", async () => {
    await seed("active"); state.mode = "error";
    const portal = await request("/management-link"); expect(portal.status).toBe(503);
    expect(diagnostics).toContainEqual({ msg: "billing_stripe_portal_failed", fields: {
      traceId: portal.headers.get("x-trace-id"), err: { stage: "http", reason: "upstream_http_error", status: 500 },
    } });
    databaseFault = "read";
    try {
      const read = await request(""); expect(read.status).toBe(503);
      expect(diagnostics).toContainEqual({ msg: "billing_subscription_store_failed", fields: {
        traceId: read.headers.get("x-trace-id"), err: { stage: "read", reason: "database_failure" },
      } });
    } finally { databaseFault = null; }
    const serialized = JSON.stringify(diagnostics);
    for (const forbidden of [...privateFixtureValues, "cus_f08trusted", "https://billing.stripe.com/p/session/", "client_reference_id", "permission denied", "billing_subscriptions"]) expect(serialized).not.toContain(forbidden);
  });
  it("diagnostic sink failures do not replace the original 503", async () => {
    await seed("active"); state.mode = "error"; sinkFails = true;
    expect((await request("/management-link")).status).toBe(503);
    databaseFault = "read";
    try { expect((await request("")).status).toBe(503); }
    finally { databaseFault = null; }
  });
  it("the same authenticated user reads the same subscription across organization switches", async () => {
    await seed("active");
    const first = await (await request("")).json();
    expect(await (await request("", user, "f08-sub-other-org")).json()).toEqual(first);
    expect((await (await request("", other, "f08-sub-other-org")).json()).status).toBe("none");
  });
  it("unknown raw states in an owned PG projection fail closed rather than returning none or stale Pro", async () => {
    await seed("active"); databaseFault = "unknown";
    try {
      for (const path of ["", "/upgrade-link", "/management-link"]) expect((await request(path)).status).toBe(503);
      expect(state.calls).toHaveLength(0);
    } finally { databaseFault = null; }
    expect((await asOwner(c => c.query("SELECT status FROM billing_subscriptions WHERE user_id=$1", [user]))).rows[0]?.status).toBe("active");
  });
  it("reuses one order across repeated tabs without creating new recurring intents",async()=>{
    expect((await request("/upgrade-link")).status).toBe(201);
    const responses=await Promise.all(Array.from({length:5},()=>request("/upgrade-link")));
    expect(responses.every(r=>r.status===201)).toBe(true);
    const urls=await Promise.all(responses.map(r=>r.json().then(x=>x.url)));expect(new Set(urls).size).toBe(1);
    expect((await asOwner(c=>c.query("SELECT 1 FROM billing_monthly_orders WHERE user_id=$1",[user]))).rows).toHaveLength(1);
  });
  it("preserves legacy intent history while issuing a new one-time order",async()=>{
    await asOwner(c=>c.query("INSERT INTO billing_purchase_intents(intent_hash,user_id,expected_generation) VALUES(repeat('a',64),$1,0)",[user]));
    expect((await request("/upgrade-link")).status).toBe(201);
    expect((await asOwner(c=>c.query("SELECT intent_hash FROM billing_purchase_intents WHERE user_id=$1",[user]))).rows).toEqual([{intent_hash:"a".repeat(64)}]);
  });
  it.each(["intent-count", "insert"] as const)("%s transaction failure returns 503 and retains prior correlation history without issuing a link", async fault => {
    await asOwner(c => c.query(`INSERT INTO billing_purchase_intents(intent_hash,user_id,created_at,expires_at,expected_generation)
      VALUES (repeat('d',64),$1,now()-interval '2 days',now()-interval '1 day',0)`, [user]));
    databaseFault = fault;
    try {
      const response = await request("/upgrade-link"); expect(response.status).toBe(503);
      const body = await response.json(); expect(body).toMatchObject({ error: "dependency_unavailable" }); expect(body).not.toHaveProperty("url");
      expect((await asOwner(c => c.query("SELECT intent_hash FROM billing_purchase_intents WHERE user_id=$1", [user]))).rows).toEqual([{ intent_hash: "d".repeat(64) }]);
    } finally { databaseFault = null; }
  });
  it("app role can read snapshots but cannot write them; intent owner/expiry/digest are immutable", async () => {
    await seed("active"); await expect(asApp(org, c => c.query("UPDATE billing_subscriptions SET status='canceled' WHERE user_id=$1", [user]))).rejects.toThrow(/permission denied/);
    await cleanup(); await request("/upgrade-link"); await expect(asApp(org, c => c.query("UPDATE billing_purchase_intents SET user_id=$1", [other]))).rejects.toThrow(/permission denied/);
    await expect(asApp(org, c => c.query("DELETE FROM billing_purchase_intents WHERE user_id=$1", [user]))).rejects.toThrow(/permission denied/);
  });
});
