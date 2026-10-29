import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BillingModule } from "../../src/billing.module";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { registerBillingRawBodyParser } from "../../src/interface/middleware/billing-raw-body-parser";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { toOrgId } from "../../src/domain/org-id";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
const secret = `whsec_${randomBytes(24).toString("hex")}`, user = "f09-stripe-user";
let app: NestExpressApplication, server: Server, base: string;
let snapshots: Record<string, unknown> = {}, calls: string[] = [];
const subscription = (id = "sub_f09A", status = "active") => ({ id, object: "subscription", customer: "cus_f09A", status, cancel_at_period_end: false, trial_start: null, trial_end: null,
  items: { data: [{ current_period_start: 1893456000, current_period_end: 1896134400, price: { id: "price_f09", recurring: { interval: "month" } } }], has_more: false } });
async function cleanup() { await asOwner(async c => {
  await c.query("DELETE FROM billing_stripe_bindings WHERE user_id LIKE 'f09-stripe-%'");
  await c.query("DELETE FROM billing_stripe_reconciliation WHERE provider_event_id LIKE 'evt_f09%'");
  await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_f09%'");
  await c.query("DELETE FROM billing_purchase_intents WHERE user_id LIKE 'f09-stripe-%'");
  await c.query("DELETE FROM billing_subscriptions WHERE user_id LIKE 'f09-stripe-%'");
}); }
async function post(type: string, object: unknown, id = "evt_f09test", signature = true, timestamp = Math.floor(Date.now()/1000)) {
  const body = JSON.stringify({ id, object: "event", type, data: { object } });
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return fetch(`${base}/billing/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature ? digest : "0".repeat(64)}` }, body });
}
async function intent() { const response = await fetch(`${base}/billing/subscription/upgrade-link`,{headers:{authorization:"Bearer fixture"}}); expect(response.status).toBe(200); return new URL((await response.json()).url).searchParams.get("client_reference_id")!; }
async function checkout(token: string, id = "sub_f09A", eventId = "evt_f09checkout") {
  const session = { id: "cs_test_f09", object: "checkout.session", mode: "subscription", status: "complete", customer: "cus_f09A", subscription: id, client_reference_id: token };
  snapshots["/v1/checkout/sessions/cs_test_f09"] = session;
  return post("checkout.session.completed", session, eventId);
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  for (const [k,v] of Object.entries({ STRIPE_SECRET_KEY: `sk_test_${randomBytes(16).toString("hex")}`, STRIPE_WEBHOOK_SECRET: secret, STRIPE_PAYMENT_LINK: "https://buy.stripe.com/f09", STRIPE_MANAGEMENT_PORTAL: "https://billing.stripe.com/p/login/f09" })) vi.stubEnv(k,v);
  server = createServer((req,res) => { calls.push(req.url!); expect(req.headers["stripe-version"]).toBe("2025-09-30.clover"); const value = snapshots[req.url!]; res.statusCode = value ? 200 : 500; res.end(JSON.stringify(value ?? { error: "fixture unavailable" })); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve)); const addr = server.address(); if (!addr || typeof addr === "string") throw Error("listener");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => { const url = new URL(input instanceof Request ? input.url : String(input)); return nativeFetch(url.origin === "https://api.stripe.com" ? `http://127.0.0.1:${addr.port}${url.pathname}` : input, init); });
  app = await NestFactory.create<NestExpressApplication>({ module: class StripeRoot {}, imports: [BillingModule], providers: [
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string,string>) => headers.authorization ? ({ userId: user, orgId: toOrgId("f09-stripe-org") }) : null } }, { provide: APP_GUARD, useClass: PrincipalGuard },
  ] }, { logger: false, bodyParser: false });
  app.useGlobalFilters(new AllExceptionsFilter({info(){},error(){}} as never,{record:async()=>{}} as never));
  registerBillingRawBodyParser(app.getHttpAdapter().getInstance());
  await app.listen(0,"127.0.0.1"); const address = app.getHttpServer().address(); if(!address || typeof address === "string") throw Error("listener"); base = `http://127.0.0.1:${address.port}`;
},120000);
beforeEach(async () => { await cleanup(); snapshots = { "/v1/subscriptions/sub_f09A": subscription() }; calls = []; });
afterAll(async () => { if (app) { await app.close(); await app.get<DatabasePort>(DATABASE_PORT).close(); } if(server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } await cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("rejects forged and stale signatures before any provider call or audit write", async () => {
  expect((await post("checkout.session.completed", {}, undefined, false)).status).toBe(400);
  expect((await post("checkout.session.completed", {}, undefined, true, 1)).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await asOwner(c => c.query("SELECT * FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_f09%'"))).rows).toEqual([]);
});
it("audits unknown events once with signed public ACK", async () => { for(let i=0;i<2;i++) expect((await post("unknown.future", {})).status).toBe(200); expect((await asOwner(c => c.query("SELECT result FROM billing_webhook_events WHERE provider_event_id='evt_f09test'"))).rows).toEqual([{ result: "ignored" }]); });
it("binds only opaque issued intent from verified checkout and replays atomically without credit changes", async () => {
  const token = await intent(); expect((await checkout(token)).status).toBe(200); expect((await checkout(token)).status).toBe(200);
  expect((await asOwner(c => c.query("SELECT status,subscription_ref,binding_generation FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{ status: "active", subscription_ref: "sub_f09A", binding_generation: "1" }]);
  expect((await asOwner(c => c.query("SELECT consumed_subscription_ref FROM billing_purchase_intents WHERE user_id=$1",[user]))).rows).toEqual([{ consumed_subscription_ref: "sub_f09A" }]);
  expect((await asOwner(c => c.query("SELECT * FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([]);
});
it("unknown current state remains retryable and valid recovery clears binding-scoped uncertainty", async () => {
  expect((await checkout(await intent())).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09A"] = {id:"sub_f09A",object:"subscription",customer:"cus_f09A",status:"future_state"};
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(500);
  expect((await asOwner(c=>c.query("SELECT status,synchronization_uncertain FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{status:"active", synchronization_uncertain:true}]);
  expect((await asOwner(c=>c.query("SELECT * FROM billing_webhook_events WHERE provider_event_id='evt_f09test'"))).rows).toEqual([]);
  for(const path of ["","/upgrade-link","/management-link"]) expect((await fetch(`${base}/billing/subscription${path}`,{headers:{authorization:"Bearer fixture"}})).status).toBe(503);
  snapshots["/v1/subscriptions/sub_f09A"] = subscription("sub_f09A","paused");
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT status,synchronization_uncertain FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{status:"paused", synchronization_uncertain:false}]);
});
it("retired A including unknown state cannot overwrite B or poison its health", async () => {
  expect((await checkout(await intent())).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09A"] = subscription("sub_f09A","canceled"); expect((await post("customer.subscription.deleted",{id:"sub_f09A"},"evt_f09cancel")).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09B"] = subscription("sub_f09B"); expect((await checkout(await intent(),"sub_f09B","evt_f09B")).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09A"] = {id:"sub_f09A",object:"subscription",customer:"cus_f09A",status:"future_state"};
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(200);
  delete snapshots["/v1/subscriptions/sub_f09A"];
  expect((await post("customer.subscription.updated",{id:"sub_f09A"},"evt_f09retiredFailure")).status).toBe(200);
  expect((await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT subscription_ref,status,synchronization_uncertain FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{subscription_ref:"sub_f09B",status:"active",synchronization_uncertain:false}]);
});
it("provider failures remain retryable and missing subscription correlation is never terminal",async()=>{ expect((await post("customer.subscription.updated",{id:"sub_f09unknown"})).status).toBe(500); expect((await asOwner(c=>c.query("SELECT * FROM billing_webhook_events WHERE provider_event_id='evt_f09test'"))).rows).toEqual([]); });
it("a failed provider fetch retries the same event and preserves zero Stripe credit ledger activity",async()=>{
  expect((await checkout(await intent())).status).toBe(200);
  delete snapshots["/v1/subscriptions/sub_f09A"];
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(500);
  snapshots["/v1/subscriptions/sub_f09A"]=subscription("sub_f09A","incomplete_expired");
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT status FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{status:"incomplete_expired"}]);
  expect((await asOwner(c=>c.query("SELECT t.* FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1",[user]))).rows).toEqual([]);
});
it("never trusts a browser user reference or mismatched authoritative checkout customer",async()=>{
  expect((await checkout(user)).status).toBe(500);
  const token=await intent(); snapshots["/v1/subscriptions/sub_f09A"]={...subscription(),customer:"cus_wrong"};
  expect((await checkout(token)).status).toBe(500);
  expect((await asOwner(c=>c.query("SELECT * FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([]);
});
it("rejects multiple recurring items without applying or terminally acknowledging",async()=>{
  const sub=subscription(); sub.items.data.push(sub.items.data[0]!); snapshots["/v1/subscriptions/sub_f09A"]=sub;
  expect((await checkout(await intent())).status).toBe(500);
  expect((await asOwner(c=>c.query("SELECT * FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([]);
});
it("serializes concurrent replay and current snapshots without creating duplicate bindings",async()=>{
  const token=await intent(); const results=await Promise.all(Array.from({length:5},()=>checkout(token)));
  expect(results.map(r=>r.status)).toEqual([200,200,200,200,200]);
  expect((await asOwner(c=>c.query("SELECT count(*)::int n FROM billing_stripe_bindings WHERE user_id=$1",[user]))).rows).toEqual([{n:1}]);
});
// Expiry fault affects only f09-stripe-user; cleanup removes its retained history.
it("retains expired intent correlation and records late paid subscription for manual reconciliation",async()=>{
  const token=await intent();
  await asOwner(c=>c.query("UPDATE billing_purchase_intents SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",[user]));
  expect((await checkout(token)).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT reason FROM billing_stripe_reconciliation WHERE provider_event_id='evt_f09checkout'"))).rows).toEqual([{reason:"intent_expired"}]);
  expect((await asOwner(c=>c.query("SELECT consumed_subscription_ref FROM billing_purchase_intents WHERE user_id=$1",[user]))).rows).toEqual([{consumed_subscription_ref:null}]);
  expect((await asOwner(c=>c.query("SELECT * FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([]);
});
it("a consumed intent cannot bind a second subscription and invoice failure uses authoritative current state",async()=>{
  const token=await intent(); expect((await checkout(token)).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09B"]=subscription("sub_f09B");
  expect((await checkout(token,"sub_f09B","evt_f09B")).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT subscription_ref FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{subscription_ref:"sub_f09A"}]);
  snapshots["/v1/subscriptions/sub_f09A"]=subscription("sub_f09A","past_due");
  expect((await post("invoice.payment_failed",{parent:{subscription_details:{subscription:"sub_f09A"}}})).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT status FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{status:"past_due"}]);
});
it("an unknown first verified binding blocks none and repeat purchase until the same subscription recovers",async()=>{
  const token=await intent(); snapshots["/v1/subscriptions/sub_f09A"]={id:"sub_f09A",object:"subscription",customer:"cus_f09A",status:"future_state"};
  expect((await checkout(token)).status).toBe(500);
  for(const path of ["","/upgrade-link","/management-link"]) expect((await fetch(`${base}/billing/subscription${path}`,{headers:{authorization:"Bearer fixture"}})).status).toBe(503);
  snapshots["/v1/subscriptions/sub_f09A"]=subscription();
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(200);
  expect((await asOwner(c=>c.query("SELECT status FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([{status:"active"}]);
});
it.each(["unavailable","invalid-items"])("current %s snapshot cannot leave old active confirmed and recovery clears health",async mode=>{
  expect((await checkout(await intent())).status).toBe(200);
  if(mode==="unavailable") delete snapshots["/v1/subscriptions/sub_f09A"];
  else snapshots["/v1/subscriptions/sub_f09A"]={...subscription(),items:{data:[],has_more:false}};
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(500);
  expect((await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).status).toBe(503);
  snapshots["/v1/subscriptions/sub_f09A"]=subscription();
  expect((await post("customer.subscription.updated",{id:"sub_f09A"})).status).toBe(200);
  expect((await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).status).toBe(200);
});

it("period-end cancellation preserves Pro until the authoritative subscription ends", async () => {
  expect((await checkout(await intent())).status).toBe(200);
  snapshots["/v1/subscriptions/sub_f09A"] = { ...subscription(), cancel_at_period_end: true };
  expect((await post("customer.subscription.updated", { id: "sub_f09A" }, "evt_f09cancelScheduled")).status).toBe(200);
  const read = () => fetch(`${base}/billing/subscription`, { headers: { authorization: "Bearer fixture" } });
  expect(await (await read()).json()).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  snapshots["/v1/subscriptions/sub_f09A"] = { ...subscription("sub_f09A", "canceled"), cancel_at_period_end: false };
  expect((await post("customer.subscription.deleted", { id: "sub_f09A" }, "evt_f09cancelEnded")).status).toBe(200);
  expect(await (await read()).json()).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });
});
