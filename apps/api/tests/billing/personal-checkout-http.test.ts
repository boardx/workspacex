import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { BillingOrderService } from "../../src/application/billing/billing-order-service";
import { BillingOrderController } from "../../src/interface/controllers/billing-order.controller";
import { PgBillingOrderRepository } from "../../src/infrastructure/billing/pg-billing-order-repository";
import { PgPersonalOrderReader } from "../../src/infrastructure/billing/pg-personal-order-reader";
import { PersonalCheckoutResult } from "@repo/contracts/billing-pricing";
import { PersonalCheckoutController } from "../../src/interface/controllers/personal-checkout.controller";
import { PersonalEntitlementController } from "../../src/interface/controllers/personal-entitlement.controller";
import { PersonalEntitlementService } from "../../src/application/billing/personal-entitlement-service";
import { PgPersonalEntitlementRepository } from "../../src/infrastructure/billing/pg-personal-entitlement-repository";
import { PersonalCheckoutService } from "../../src/application/billing/personal-checkout-service";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { personalStripePaymentFixture } from "./personal-stripe-payment-fixture";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase, migrateOnce, seedOrg, asOwner } from "../support/db";
import { toOrgId } from "../../src/domain/org-id";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";

const prefix = `checkout-http-${randomUUID().slice(0, 8)}`, org = toOrgId(prefix), userId = `${prefix}-user`;
const recoveryUserId=`${prefix}-recovery`,ownedUsers=[userId,recoveryUserId];
const db = new PgDatabase(appConfig()); let app: INestApplication, base: string, calls = 0;
let salesEnabled=true,loseCreationResponse=false;
const request = { sku: "pro-us-year-v1", provider: "stripe", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `http-${randomUUID()}` };
// Intent/financial fixture ownership: exact ownedUsers are deleted after the isolated HTTP server closes.
// Epoch fixture ownership: this isolated database is restored to inactive in afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: userId, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
  const service = new PersonalCheckoutService(new PgPersonalCheckoutRepository(db), {
    getPricingMarket: () => "us", getPublicConfig: () => ({ enabledProviders: salesEnabled?["stripe"]:[] }),
  }, { enabled: () => true, create: async purchase => {
    calls++;if(loseCreationResponse)throw Error("fixture_lost_creation_response");return { sessionRef: `cs_${purchase.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: new Date(Date.now() + 86400000) };
  } });
  app = await NestFactory.create({ module: class CheckoutHttpFixture {}, controllers: [PersonalCheckoutController, PersonalEntitlementController, BillingOrderController], providers: [
    { provide: PersonalCheckoutService, useValue: service },
    { provide: BillingOrderService, useValue: new BillingOrderService(new PgBillingOrderRepository(db), { findOrgMembership: async () => null },
      { getPricingMarket: () => "us", getPublicConfig: () => ({ enabledProviders: [] }) },
      { createNativeOrder: async () => { throw Error("unexpected_native_creation"); }, closeNativeOrder: async () => { throw Error("unexpected_native_close"); } }, undefined, new PgPersonalOrderReader(db)) },
    { provide: PersonalEntitlementService, useValue: new PersonalEntitlementService(new PgPersonalEntitlementRepository(db)) },
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string, string | undefined>) => headers.authorization === "Bearer checkout-fixture" ? { userId, orgId: org } : headers.authorization === "Bearer recovery-fixture"?{userId:recoveryUserId,orgId:org}:headers.authorization === "Bearer other-fixture" ? { userId: `${prefix}-stranger`, orgId: org } : null } },
    { provide: APP_GUARD, useClass: PrincipalGuard },
  ] }, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, { record: vi.fn(), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() }));
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
afterAll(async () => {
  await app?.close(); await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_stripe_bindings WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))",[ownedUsers]);
    await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))",[ownedUsers]);
    await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])",[ownedUsers]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[ownedUsers]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[ownedUsers]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[ownedUsers]);
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])", [ownedUsers]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close();
});
async function post(body: unknown, authenticated = true) {
  return fetch(`${base}/billing/checkout`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer checkout-fixture" } : {}) }, body: JSON.stringify(body) });
}
it("requires the real PrincipalGuard and rejects browser-owned money or account fields", async () => {
  expect((await post(request, false)).status).toBe(401);
  for (const extra of [{ amountMinor: 1 }, { userId: "victim" }, { market: "cn" }]) expect((await post({ ...request, ...extra })).status).toBe(400);
  expect(calls).toBe(0);
});
it("uses the declared code envelope for precreation rejections without reserving an intent", async () => {
  const rejectedKeys: string[] = [];
  const reject = async (code: string, status: number, fields: Record<string, unknown> = {}) => {
    const idempotencyKey = `rejected-${randomUUID()}`; rejectedKeys.push(idempotencyKey);
    const response = await post({ ...request, ...fields, idempotencyKey });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ code, error: expect.any(String), traceId: expect.any(String) });
    expect(body).not.toHaveProperty("reasonCode");
  };
  await reject("catalog_changed", 409, { catalogVersion: "outdated-catalog" });
  await reject("product_unavailable", 409, { sku: "unavailable-sku" });
  salesEnabled = false;
  try { await reject("payment_provider_not_configured", 503); } finally { salesEnabled = true; }
  expect(calls).toBe(0);
  const count = await asOwner(async c => (await c.query("SELECT count(*)::int AS count FROM billing_personal_purchases WHERE user_id=$1 AND idempotency_key=ANY($2::text[])", [userId, rejectedKeys])).rows[0].count);
  expect(count).toBe(0);
});
it("returns one durable result across actual HTTP retries and safely exposes a declared conflict", async () => {
  const first = await post(request); expect(first.status).toBe(201); expect(first.headers.get("cache-control")).toBe("no-store");
  const result = PersonalCheckoutResult.parse(await first.json());
  expect(result.renewalMode).toBe("automatic");
  expect(await (await post(request)).json()).toEqual(result); expect(calls).toBe(1);
  const conflict = await post({ ...request, sku: "pro-us-month-v1" });
  expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "idempotency_conflict" });
  const duplicateKey = `duplicate-${randomUUID()}`;
  const duplicate = await post({ ...request, idempotencyKey: duplicateKey });
  expect(duplicate.status).toBe(409);
  const body = await duplicate.json();
  expect(body).toMatchObject({ code: "already_subscribed", error: expect.any(String), traceId: expect.any(String) });
  expect(body).not.toHaveProperty("reasonCode");
  const count = await asOwner(async c => (await c.query("SELECT count(*)::int AS count FROM billing_personal_purchases WHERE user_id=$1 AND idempotency_key=$2", [userId, duplicateKey])).rows[0].count);
  expect(count).toBe(0); expect(calls).toBe(1);
});
it("authenticates the entitlement read and rejects attempts to choose another account", async () => {
  const path = `${base}/billing/subscription/entitlement`, headers = { authorization: "Bearer checkout-fixture" };
  expect((await fetch(path)).status).toBe(401);
  expect((await fetch(`${path}?userId=victim`, { headers })).status).toBe(400);
  const response = await fetch(path, { headers }); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ status: "none", plan: null, billingCycle: null, renewalMode: null,
    checkoutPending: true, creditGrant: { status: "none", grant: null }, welcomeCreditGrant: { status: "none", grant: null } });
});

it("reads new orders through the existing private HTTP operation and refuses cross-payer reads or legacy cancellation", async () => {
  const result = PersonalCheckoutResult.parse(await (await post(request)).json()), path = `${base}/billing/orders/${result.purchaseRef}`;
  expect((await fetch(path)).status).toBe(401);
  expect((await fetch(path, { headers: { authorization: "Bearer other-fixture" } })).status).toBe(404);
  const headers = { authorization: "Bearer checkout-fixture" }, response = await fetch(path, { headers });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ order: { orderNo: result.purchaseRef, ownerId: userId, status: "PENDING", amountFen: 29000, currency: "USD", packageId: request.sku, baseCredits: 20000 } });
  expect((await fetch(`${path}/cancel`, { method: "POST", headers })).status).toBe(409);
  expect(calls).toBe(1);
});
it("recovers the paid original HTTP request without original checkout binding after new sales are disabled",async()=>{
 const headers={authorization:"Bearer recovery-fixture","content-type":"application/json"},body={...request,idempotencyKey:`recovery-${randomUUID()}`};
 const send=()=>fetch(`${base}/billing/checkout`,{method:"POST",headers,body:JSON.stringify(body)});
 const beforeCalls=calls;loseCreationResponse=true;expect((await send()).status).toBe(503);
 const principal={userId:recoveryUserId,orgId:org},repository=new PgPersonalCheckoutRepository(db);
 let purchase=await repository.find(principal,body.idempotencyKey);expect(purchase).toMatchObject({url:null,expiresAt:null,fulfilledAt:null});if(!purchase)throw Error("durable_purchase_required");
 const anchor=new Date(Math.floor(Date.now()/1000)*1000);
 await asOwner(c=>c.query("UPDATE billing_personal_purchases SET created_at=$2 WHERE purchase_ref=$1",[purchase!.purchaseRef,anchor]));
 purchase=(await repository.find(principal,body.idempotencyKey))!;const snapshots=personalStripePaymentFixture(purchase,anchor);
 await new PgPersonalPaymentRepository(db).settleStripe(purchase.purchaseRef,snapshots.subscription.id,snapshots.invoice.id,async locked=>snapshots.proof(locked));
 const facts=()=>asOwner(async c=>(await c.query("SELECT balance::text,total_granted,(SELECT count(*)::int FROM billing_personal_payment_receipts WHERE purchase_ref=$1) AS receipts,(SELECT count(*)::int FROM credit_transactions t WHERE t.wallet_id=w.wallet_id) AS entries FROM credit_wallets w WHERE owner_type='user' AND owner_id=$2",[purchase!.purchaseRef,recoveryUserId])).rows[0]);
 const credited=await facts();expect(credited).toEqual({balance:"20000.00",total_granted:20000,receipts:1,entries:1});
 salesEnabled=false;loseCreationResponse=false;const retry=await send();expect(retry.status).toBe(201);expect(retry.headers.get("cache-control")).toBe("no-store");
 expect(await retry.json()).toMatchObject({purchaseRef:purchase.purchaseRef,url:null,expiresAt:null});expect(calls).toBe(beforeCalls+1);
 const path=`${base}/billing/orders/${purchase.purchaseRef}`;expect((await fetch(path)).status).toBe(401);
 expect((await fetch(path,{headers:{authorization:"Bearer checkout-fixture"}})).status).toBe(404);
 for(let n=0;n<2;n++){const response=await fetch(path,{headers});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toMatchObject({order:{status:"SUCCESS",qrCodeUrl:null,expiredAt:null,notifyAt:null,paidAt:anchor.toISOString()}});}
 expect(await facts()).toEqual(credited);expect(calls).toBe(beforeCalls+1);
});
