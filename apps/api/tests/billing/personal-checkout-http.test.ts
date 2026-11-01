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
const db = new PgDatabase(appConfig()); let app: INestApplication, base: string, calls = 0;
const request = { sku: "pro-us-year-v1", provider: "stripe", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `http-${randomUUID()}` };
// Intent fixture ownership: exact userId is deleted after the isolated HTTP server closes.
// Epoch fixture ownership: this isolated database is restored to inactive in afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: userId, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
  const service = new PersonalCheckoutService(new PgPersonalCheckoutRepository(db), {
    getPricingMarket: () => "us", getPublicConfig: () => ({ enabledProviders: ["stripe"] }),
  }, { enabled: () => true, create: async purchase => {
    calls++; return { sessionRef: `cs_${purchase.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: new Date(Date.now() + 86400000) };
  } });
  app = await NestFactory.create({ module: class CheckoutHttpFixture {}, controllers: [PersonalCheckoutController, PersonalEntitlementController, BillingOrderController], providers: [
    { provide: PersonalCheckoutService, useValue: service },
    { provide: BillingOrderService, useValue: new BillingOrderService(new PgBillingOrderRepository(db), { findOrgMembership: async () => null },
      { getPricingMarket: () => "us", getPublicConfig: () => ({ enabledProviders: [] }) },
      { createNativeOrder: async () => { throw Error("unexpected_native_creation"); }, closeNativeOrder: async () => { throw Error("unexpected_native_close"); } }, undefined, new PgPersonalOrderReader(db)) },
    { provide: PersonalEntitlementService, useValue: new PersonalEntitlementService(new PgPersonalEntitlementRepository(db)) },
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string, string | undefined>) => headers.authorization === "Bearer checkout-fixture" ? { userId, orgId: org } : headers.authorization === "Bearer other-fixture" ? { userId: `${prefix}-stranger`, orgId: org } : null } },
    { provide: APP_GUARD, useClass: PrincipalGuard },
  ] }, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, { record: vi.fn(), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() }));
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
afterAll(async () => {
  await app?.close(); await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=$1", [userId]);
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
it("returns one durable result across actual HTTP retries and safely exposes a declared conflict", async () => {
  const first = await post(request); expect(first.status).toBe(201); expect(first.headers.get("cache-control")).toBe("no-store");
  const result = PersonalCheckoutResult.parse(await first.json());
  expect(result.renewalMode).toBe("automatic");
  expect(await (await post(request)).json()).toEqual(result); expect(calls).toBe(1);
  const conflict = await post({ ...request, sku: "pro-us-month-v1" });
  expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "idempotency_conflict" });
  expect(calls).toBe(1);
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
