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
// @global-scope-fixture table:credit_wallets: renewal fixture owns only the f09-stripe-user wallet and deletes it before/after each case.
// @global-scope-fixture table:credit_subscription_periods: renewal fixture seeds one old paid period for its exact wallet; cleanup removes only that owner's batches.
// @global-scope-fixture table:billing_webhook_events: only f09 event identities are inserted and removed by cleanup.
let app: NestExpressApplication, server: Server, base: string;
let snapshots: Record<string, unknown> = {}, calls: string[] = [];
const subscription = (id = "sub_f09A", status = "active") => ({ id, object: "subscription", customer: "cus_f09A", status, cancel_at_period_end: false, trial_start: null, trial_end: null,
  items: { data: [{ current_period_start: 1893456000, current_period_end: 1896134400, price: { id: "price_f09", recurring: { interval: "month" } } }], has_more: false } });
async function cleanup() { await asOwner(async c => {
  await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)",[user]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)",[user]);
  await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]);
  await c.query("DELETE FROM billing_stripe_bindings WHERE user_id LIKE 'f09-stripe-%'");
  await c.query("DELETE FROM billing_stripe_reconciliation WHERE provider_event_id LIKE 'evt_f09%'");
  await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_f09%'");
  await c.query("DELETE FROM billing_purchase_intents WHERE user_id LIKE 'f09-stripe-%'");
  await c.query("DELETE FROM billing_subscriptions WHERE user_id LIKE 'f09-stripe-%'");
}); }
function monthlyFixture() {
 const start=Math.floor(Date.now()/1000)-15*86400,end=start+30*86400;
 snapshots["/v1/subscriptions/sub_f09A"]={...subscription(),items:{data:[{id:"si_f09",current_period_start:start,current_period_end:end,price:{id:"price_f09",recurring:{interval:"month",interval_count:1}}}],has_more:false}};
 snapshots["/v1/prices/price_f09"]={id:"price_f09",object:"price",currency:"usd",type:"recurring",recurring:{interval:"month",interval_count:1,usage_type:"licensed"}};
 snapshots["/v1/invoices/in_f09monthly"]={id:"in_f09monthly",object:"invoice",customer:"cus_f09A",status:"paid",amount_paid:1000,amount_remaining:0,currency:"usd",billing_reason:"subscription_cycle",
  parent:{type:"subscription_details",subscription_details:{subscription:"sub_f09A"}},metadata:{userId:"forged-owner-ignored"},
  lines:{data:[{id:"il_f09",quantity:1,period:{start,end},parent:{type:"subscription_item_details",subscription_item_details:{subscription:"sub_f09A",proration:false}},pricing:{type:"price_details",price_details:{price:"price_f09"}}}],has_more:false}};
 return {start,end};
}
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
it("grants a verified paid monthly invoice exactly once across duplicate and sibling signed events",async()=>{
 const period=monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 const responses=await Promise.all([post("invoice.paid",{id:"in_f09monthly"},"evt_f09paid1"),post("invoice.payment_succeeded",{id:"in_f09monthly"},"evt_f09paid2")]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09paid1")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]))).rows).toEqual([{balance:"20000.00",total_granted:20000}]);
 expect((await asOwner(c=>c.query("SELECT count(*)::int AS count FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1",[user]))).rows).toEqual([{count:1}]);
 const info=await(await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).json();
 expect(info.creditGrant).toMatchObject({status:"granted",grant:{credits:20000,remainingCredits:20000,periodEnd:new Date(period.end*1000).toISOString()}});
});
it("retries an invoice that arrives before checkout binding instead of permanently ignoring the paid event",async()=>{
 monthlyFixture();const token=await intent();
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09earlypaid")).status).toBe(500);
 expect((await checkout(token)).status).toBe(200);
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09earlypaid")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20000.00"}]);
});
it.each(["customer","status","price","subscription","truncated"])("refuses inconsistent authoritative paid invoice %s without granting credits",async field=>{
 monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 const invoice=snapshots["/v1/invoices/in_f09monthly"] as any;
 if(field==="customer")invoice.customer="cus_another";
 if(field==="status")invoice.status="open";
 if(field==="price")invoice.lines.data[0].pricing.price_details.price="price_unrelated";
 if(field==="subscription")invoice.parent.subscription_details.subscription="sub_unbound";
 if(field==="truncated")invoice.lines.has_more=true;
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09badinvoice")).status).toBe(500);
 expect((await asOwner(c=>c.query("SELECT balance FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([]);
});
it("does not interpret annual or trial subscriptions as a paid monthly credit entitlement",async()=>{
 monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 (snapshots["/v1/prices/price_f09"] as any).recurring.interval="year";
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09annualpaid")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([]);
 (snapshots["/v1/prices/price_f09"] as any).recurring.interval="month";
 (snapshots["/v1/subscriptions/sub_f09A"] as any).status="trialing";
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09trialpaid")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([]);
});
it("preserves paid current credits when auto renewal is canceled and never grants from a failed invoice",async()=>{
 monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09paid")).status).toBe(200);
 (snapshots["/v1/subscriptions/sub_f09A"] as any).cancel_at_period_end=true;
 expect((await post("customer.subscription.updated",{id:"sub_f09A"},"evt_f09cancelrenewal")).status).toBe(200);
 expect((await post("invoice.payment_failed",{parent:{subscription_details:{subscription:"sub_f09A"}}},"evt_f09failedrenewal")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20000.00",total_granted:20000}]);
});
it("can reconcile a previously ignored paid event after enabling monthly credit grants",async()=>{
 monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 await asOwner(c=>c.query("INSERT INTO billing_webhook_events(provider,provider_event_id,signature_verified,result) VALUES('stripe','evt_f09oldignored',true,'ignored')"));
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09oldignored")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20000.00"}]);
});
it("expires an old unused remainder before renewal and late invoices cannot replace the new subscription period",async()=>{
 const period=monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 const oldStart=period.start-30*86400,oldEnd=period.start;
 await asOwner(async c=>{
  const wallet=(await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_granted) VALUES('user',$1,12,20000) RETURNING wallet_id",[user])).rows[0];
  await c.query("INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths) VALUES($1,'sub_f09A','in_f09old','price_f09',$2,$3,2000000,500)",[wallet.wallet_id,new Date(oldStart*1000),new Date(oldEnd*1000)]);
 });
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09renewal")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20007.00"}]);
 const oldInvoice=structuredClone(snapshots["/v1/invoices/in_f09monthly"]) as any;
 oldInvoice.id="in_f09old";oldInvoice.lines.data[0].period={start:oldStart,end:oldEnd};snapshots["/v1/invoices/in_f09old"]=oldInvoice;
 expect((await post("invoice.paid",{id:"in_f09old"},"evt_f09lateoldpaid")).status).toBe(200);
 expect((await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user]))).rows).toEqual([{balance:"20007.00"}]);
 expect((await(await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).json()).currentPeriodEnd).toBe(new Date(period.end*1000).toISOString());
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
it("reports pending current credits when subscription advances before its paid invoice",async()=>{
 const period=monthlyFixture();expect((await checkout(await intent())).status).toBe(200);
 expect((await post("invoice.paid",{id:"in_f09monthly"},"evt_f09beforeadvance")).status).toBe(200);
 const item=(snapshots["/v1/subscriptions/sub_f09A"] as any).items.data[0];item.current_period_start=period.end;item.current_period_end=period.end+30*86400;
 expect((await post("customer.subscription.updated",{id:"sub_f09A"},"evt_f09advance")).status).toBe(200);
 const info=await(await fetch(`${base}/billing/subscription`,{headers:{authorization:"Bearer fixture"}})).json();
 expect(info.creditGrant).toEqual({status:"pending",grant:null});
});
