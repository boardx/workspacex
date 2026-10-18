// @global-scope-fixture table:billing_purchase_intents: runtime-issued f08-sub-* intents; cleanup() deletes only this fixture user prefix; INSERT text below classifies instance-local faults.
// @global-scope-fixture table:billing_subscriptions: f08-sub-* user prefix; cleanup deletes only owned fixtures.
import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
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
const state = { mode: "ok", calls: [] as { body: URLSearchParams; version: string | undefined }[] };
async function request(path: string, who: string = user, requestOrg = "f08-sub-org") {
  return fetch(`${base}/billing/subscription${path}`, { headers: who ? { authorization: `Bearer ${who}`, "x-test-org": requestOrg } : {} });
}
async function seed(status: string, uncertain = false, customer: string | null = "cus_f08trusted") {
  await asOwner(c => c.query(`INSERT INTO billing_subscriptions
    (user_id,customer_ref,subscription_ref,status,plan_ref,current_period_end,synchronization_uncertain)
    VALUES ($1,$2,'sub_f08trusted',$3,'price_f08','2030-01-01T00:00:00Z',$4)`, [user, customer, status, uncertain]));
}
async function cleanup() {
  await asOwner(async c => {
    await c.query("DELETE FROM billing_purchase_intents WHERE user_id LIKE 'f08-sub-%'");
    await c.query("DELETE FROM billing_subscriptions WHERE user_id LIKE 'f08-sub-%'");
  });
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  for (const [key, value] of Object.entries({ STRIPE_SECRET_KEY: `sk_test_${randomBytes(16).toString("hex")}`, STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString("hex")}`,
    STRIPE_PAYMENT_LINK: "https://buy.stripe.com/f08?client_reference_id=untrusted&prefilled_email=untrusted", STRIPE_MANAGEMENT_PORTAL: "https://billing.stripe.com/p/login/f08" })) { vi.stubEnv(key, value); if (key.includes("SECRET")) privateFixtureValues.push(value); }
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    state.calls.push({ body: new URLSearchParams(Buffer.concat(chunks).toString()), version: req.headers["stripe-version"] as string | undefined });
    if (state.mode === "headers-timeout") return;
    if (state.mode === "oversize") { res.end("x".repeat(65537)); return; }
    if (state.mode === "timeout") { res.flushHeaders(); res.write("{"); return; }
    if (state.mode === "redirect") { res.writeHead(302, { location: "https://evil.invalid" }); res.end(); return; }
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
      const inserting = owned && sql.includes("INSERT INTO billing_purchase_intents");
      const counting = owned && sql.includes("count(*)") && sql.includes("billing_purchase_intents");
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
    expect(await (await request("")).json()).toEqual({ status: "active", planRef: "price_f08", currentPeriodEnd: "2030-01-01T00:00:00.000Z", cancelAtPeriodEnd: false });
  });
  it.each(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"])("%s is readable but blocks repeat sale and uses trusted Portal customer", async status => {
    await seed(status);
    expect((await (await request("")).json()).status).toBe(status);
    const denied = await request("/upgrade-link"); expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "already_subscribed" });
    const result = await request("/management-link"); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ url: "https://billing.stripe.com/p/session/f08" });
    expect(state.calls).toHaveLength(1); expect(state.calls[0]!.body.get("customer")).toBe("cus_f08trusted"); expect(state.calls[0]!.version).toBe(STRIPE_API_VERSION);
  });
  it.each([null, "canceled", "incomplete_expired"])("%s can buy with a persisted opaque principal intent, not an email or user id", async status => {
    if (status) await seed(status);
    const denied = await request("/management-link"); expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "not_subscribed" });
    const response = await request("/upgrade-link"); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const { url } = await response.json(); const link = new URL(url); const token = link.searchParams.get("client_reference_id")!;
    expect(link.origin).toBe("https://buy.stripe.com"); expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(url).not.toContain(user); expect(link.searchParams.has("prefilled_email")).toBe(false);
    const rows = await asOwner(c => c.query("SELECT user_id,intent_hash,consumed_subscription_ref FROM billing_purchase_intents WHERE user_id=$1", [user]));
    expect(rows.rows).toEqual([{ user_id: user, intent_hash: createHash("sha256").update(token).digest("hex"), consumed_subscription_ref: null }]);
    expect(state.calls).toHaveLength(0);
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
        const response = await fetch(`http://127.0.0.1:${address.port}/billing/subscription/${path}`);
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
  it("bounds concurrent abandoned purchases to twenty without invalidating existing links", async () => {
    const responses = await Promise.all(Array.from({ length: 25 }, () => request("/upgrade-link")));
    expect(responses.filter(response => response.status === 200)).toHaveLength(20);
    const limited = responses.filter(response => response.status === 429); expect(limited).toHaveLength(5);
    for (const response of limited) expect(await response.json()).toMatchObject({ error: "rate_limited" });
    const tokens = await Promise.all(responses.filter(response => response.status === 200).map(async response => new URL((await response.json()).url).searchParams.get("client_reference_id")!));
    const stored = await asOwner(c => c.query("SELECT intent_hash FROM billing_purchase_intents WHERE user_id=$1", [user]));
    expect(stored.rows.map(row => row.intent_hash).sort()).toEqual(tokens.map(token => createHash("sha256").update(token).digest("hex")).sort());
    await asOwner(c => c.query(`INSERT INTO billing_purchase_intents(intent_hash,user_id,created_at,expires_at,expected_generation,consumed_subscription_ref)
      VALUES (repeat('e',64),$1,now()-interval '2 days',now()-interval '1 day',7,NULL),
      (repeat('f',64),$1,now()-interval '2 days',now()-interval '1 day',11,'sub_f08limit_history'),
      (repeat('d',64),$2,now()-interval '2 days',now()-interval '1 day',5,NULL)`, [user,other]));
    expect((await request("/upgrade-link")).status).toBe(429);
    expect((await asOwner(c => c.query("SELECT intent_hash,user_id,expected_generation FROM billing_purchase_intents WHERE intent_hash=repeat('e',64)"))).rows)
      .toEqual([{ intent_hash: "e".repeat(64), user_id: user, expected_generation: "7" }]);
    expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_purchase_intents WHERE user_id=$1 AND consumed_subscription_ref IS NULL AND expires_at>now()", [user]))).rows[0]?.n).toBe(20);
    expect((await request("/upgrade-link", other)).status).toBe(200);
    expect((await asOwner(c => c.query("SELECT intent_hash,user_id,expected_generation,consumed_subscription_ref FROM billing_purchase_intents WHERE intent_hash IN (repeat('d',64),repeat('e',64),repeat('f',64)) ORDER BY intent_hash"))).rows).toEqual([
      { intent_hash: "d".repeat(64), user_id: other, expected_generation: "5", consumed_subscription_ref: null },
      { intent_hash: "e".repeat(64), user_id: user, expected_generation: "7", consumed_subscription_ref: null },
      { intent_hash: "f".repeat(64), user_id: user, expected_generation: "11", consumed_subscription_ref: "sub_f08limit_history" },
    ]);
  });
  it("retains expired and consumed correlation history for both users while issuing a fresh intent", async () => {
    const first = await request("/upgrade-link"); const token = new URL((await first.json()).url).searchParams.get("client_reference_id")!;
    const activeHash = createHash("sha256").update(token).digest("hex");
    await asOwner(c => c.query(`INSERT INTO billing_purchase_intents(intent_hash,user_id,created_at,expires_at,expected_generation,consumed_subscription_ref)
      VALUES (repeat('a',64),$1,now()-interval '2 days',now()-interval '1 day',7,NULL),
      (repeat('b',64),$1,now()-interval '2 days',now()-interval '1 day',9,'sub_f08history'),
      (repeat('c',64),$2,now()-interval '2 days',now()-interval '1 day',5,NULL)`, [user, other]));
    expect((await request("/upgrade-link")).status).toBe(200);
    const retained = await asOwner(c => c.query("SELECT intent_hash FROM billing_purchase_intents WHERE user_id=$1", [user]));
    expect(retained.rows.map(row => row.intent_hash)).toContain(activeHash);
    expect(retained.rows.map(row => row.intent_hash)).toContain("b".repeat(64));
    expect(retained.rows.map(row => row.intent_hash)).toContain("a".repeat(64));
    expect(retained.rows).toHaveLength(4);
    const history = await asOwner(c => c.query("SELECT intent_hash,user_id,expected_generation,consumed_subscription_ref FROM billing_purchase_intents WHERE intent_hash IN (repeat('a',64),repeat('b',64),repeat('c',64)) ORDER BY intent_hash"));
    expect(history.rows).toEqual([
      { intent_hash: "a".repeat(64), user_id: user, expected_generation: "7", consumed_subscription_ref: null },
      { intent_hash: "b".repeat(64), user_id: user, expected_generation: "9", consumed_subscription_ref: "sub_f08history" },
      { intent_hash: "c".repeat(64), user_id: other, expected_generation: "5", consumed_subscription_ref: null },
    ]);
    expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_purchase_intents WHERE user_id=$1", [other]))).rows[0]?.n).toBe(1);
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
