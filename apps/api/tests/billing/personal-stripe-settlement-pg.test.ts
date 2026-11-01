import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { raw } from "express";
import { operations } from "@repo/contracts/billing-subscription";
import { BillingStripeWebhookController } from "../../src/interface/controllers/billing-stripe-webhook.controller";
import { BillingStripeWebhookService } from "../../src/application/billing/billing-stripe-webhook-service";
import { StripeWebhookClient } from "../../src/infrastructure/billing/stripe-webhook-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";
import { toOrgId } from "../../src/domain/org-id";
import { personalStripePaymentFixture } from "./personal-stripe-payment-fixture";
import { PersonalStripeWebhookStore } from "../../src/infrastructure/billing/personal-stripe-webhook-store";
import { vi } from "vitest";
import { PgPersonalEntitlementRepository } from "../../src/infrastructure/billing/pg-personal-entitlement-repository";

const prefix = `stripe-term-${randomUUID().slice(0, 8)}`, org = toOrgId(prefix), users: string[] = [];
const db = new PgDatabase(appConfig()), checkout = new PgPersonalCheckoutRepository(db);
// All purchases, bindings, receipts, terms and ledgers belong to exact recorded users; afterAll deletes only them.
// Epoch fixture ownership: dedicated isolated DB marker is restored to inactive afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_stripe_bindings WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])", [users]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close();
});
async function fixture(label: string, year = true, anchor = new Date(Math.floor(Date.now() / 1000) * 1000)) {
  const userId = `${prefix}-${label}`; users.push(userId); const principal = { userId, orgId: org }, product = PERSONAL_PRICE_CATALOG.us[year ? 1 : 0];
  let purchase = await checkout.reserve(principal, { sku: product.sku, provider: "stripe", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `stripe-${randomUUID()}` }, product);
  // Test-only virtual clock: app_rw cannot alter this immutable creation column.
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET created_at=$2 WHERE purchase_ref=$1", [purchase.purchaseRef, anchor]));
  const result = { sessionRef: `cs_${purchase.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: new Date(anchor.getTime() + 86400000) };
  purchase = await checkout.bind(principal, purchase.purchaseRef, result);
  const snapshots = personalStripePaymentFixture(purchase, anchor);
  const at = new Date(anchor.getTime() + 1000), store = new PgPersonalPaymentRepository(db, () => at);
  const settle = (value = snapshots, current = store) => current.settleStripe(purchase.purchaseRef, value.subscription.id, value.invoice.id, async locked => value.proof(locked));
  const wallet = () => asApp(org, async c => (await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId])).rows[0]);
  return { userId, purchase, snapshots, settle, wallet, anchor };
}
it("persists one annual Stripe invoice and binding while granting only the first month", async () => {
  const f = await fixture("annual"); await Promise.all([f.settle(), f.settle()]);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
  const binding = await asApp(org, async c => (await c.query("SELECT status,cancel_at_period_end,purchase_anchor FROM billing_personal_stripe_bindings WHERE purchase_ref=$1", [f.purchase.purchaseRef])).rows[0]);
  expect(binding).toMatchObject({ status: "active", cancel_at_period_end: false, purchase_anchor: f.anchor });
});
it("preserves the stored Jan31 anchor through a clamped February renewal", async () => {
  const anchor = new Date("2028-01-31T12:00:00Z"), f = await fixture("month-end", false, anchor); await f.settle();
  const renewal = personalStripePaymentFixture(f.purchase, anchor, 1);
  const later = new PgPersonalPaymentRepository(db, () => new Date(creditMonthBoundary(anchor, 1).getTime() + 1000));
  await f.settle(renewal, later);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 40000 });
  const term = await asApp(org, async c => (await c.query("SELECT purchase_anchor,month_offset,period_end FROM billing_personal_terms WHERE user_id=$1 ORDER BY period_start DESC LIMIT 1", [f.userId])).rows[0]);
  expect(term).toEqual({ purchase_anchor: anchor, month_offset: 1, period_end: new Date("2028-03-31T12:00:00Z") });
});
it("updates a verified cancellation snapshot on an invoice replay without regranting", async () => {
  const f = await fixture("cancel"); await f.settle(); f.snapshots.subscription.cancel_at_period_end = true; await f.settle();
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
  const binding = await asApp(org, async c => (await c.query("SELECT cancel_at_period_end FROM billing_personal_stripe_bindings WHERE purchase_ref=$1", [f.purchase.purchaseRef])).rows[0]);
  expect(binding.cancel_at_period_end).toBe(true);
});
it("does not bind another user's purchase to an existing Stripe customer", async () => {
  const first = await fixture("customer-owner"), other = await fixture("customer-other"); await first.settle();
  other.snapshots.checkout.customer = first.snapshots.checkout.customer; other.snapshots.subscription.customer = first.snapshots.subscription.customer;
  other.snapshots.invoice.customer = first.snapshots.invoice.customer;
  await expect(other.settle()).rejects.toThrow("personal_stripe_customer_owner_mismatch"); expect(await other.wallet()).toBeUndefined();
});
function callback(f: Awaited<ReturnType<typeof fixture>>) {
  const provider = { checkout: vi.fn(async () => f.snapshots.checkout), subscription: vi.fn(async () => f.snapshots.subscription),
    invoice: vi.fn(async () => f.snapshots.invoice), price: vi.fn(async () => f.snapshots.price) };
  const legacy = { apply: vi.fn(async () => true) };
  const store = new PersonalStripeWebhookStore(db, { retrieve: provider.checkout, liveMode: () => false }, new PgPersonalPaymentRepository(db), legacy);
  const apply = (type = "invoice.paid", object: Record<string, unknown> = f.snapshots.invoice) => store.apply({ id: `evt_${randomUUID().replaceAll("-", "")}`, type, object }, provider);
  return { provider, legacy, apply, store };
}
it("credits an authoritative invoice once across different Stripe event ids", async () => {
  const f = await fixture("webhook"), handler = callback(f);
  await Promise.all([handler.apply(), handler.apply()]);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
  expect(handler.legacy.apply).not.toHaveBeenCalled();
});
it("recovers a missed Stripe callback without fabricating a signature-verified event", async () => {
  const f = await fixture("poll-recovery"), handler = callback(f);
  expect(await handler.store.reconcileCheckout(f.purchase.sessionRef!, handler.provider)).toBe(true);
  f.snapshots.subscription.cancel_at_period_end = true;
  expect(await handler.store.reconcileSubscription(f.snapshots.subscription.id, handler.provider)).toBe(true);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
  expect(handler.legacy.apply).not.toHaveBeenCalled();
});
it("does not use legacy synchronization when an internal new-generation poll runs before activation", async () => {
  const f = await fixture("inactive-poll"), handler = callback(f);
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  try {
    await expect(handler.store.reconcileCheckout(f.purchase.sessionRef!, handler.provider)).rejects.toThrow("personal_recovery_inactive");
    expect(handler.legacy.apply).not.toHaveBeenCalled(); expect(await f.wallet()).toBeUndefined();
  } finally {
    await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
  }
});
async function missedInvoiceFixture(label: string) {
  // Virtual accounting time keeps historical expiry assertions independent of the wall clock running CI.
  const anchor = new Date("2026-08-31T12:00:00Z"), f = await fixture(label, false, anchor); await f.settle();
  const records = [2, 1, 0].map(offset => personalStripePaymentFixture(f.purchase, anchor, offset));
  const provider = { checkout: async () => f.snapshots.checkout, subscription: async () => records[0]!.subscription,
    price: async () => records[0]!.price, invoice: async (id: string) => {
      const value = records.find(record => record.invoice.id === id)?.invoice; if (!value) throw Error("unknown_invoice_fixture"); return value;
    }, paidInvoices: vi.fn(async () => ({ data: records.map(record => record.invoice), hasMore: false })) };
  const store = new PersonalStripeWebhookStore(db, { retrieve: provider.checkout, liveMode: () => false },
    new PgPersonalPaymentRepository(db, () => new Date("2026-11-01T12:00:00Z")), { apply: async () => { throw Error("unexpected_legacy_poll"); } });
  return { ...f, records, provider, store };
}
it("recovers every paid month in a page without duplicating the latest or restoring expired credits", async () => {
  const f = await missedInvoiceFixture("invoice-page");
  expect(await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, f.provider)).toEqual({ nextCursor: null, interrupted: false });
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 60000 });
  await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, f.provider);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 60000 });
  const rows = await asApp(org, async c => (await c.query("SELECT month_offset,purchase_anchor FROM billing_personal_terms WHERE user_id=$1 ORDER BY month_offset", [f.userId])).rows);
  expect(rows.map(row => row.month_offset)).toEqual([0, 1, 2]); expect(rows.every(row => row.purchase_anchor.getTime() === f.anchor.getTime())).toBe(true);
});
it("finishes an admitted invoice but keeps the original page cursor when shutdown interrupts a page", async () => {
  const f = await missedInvoiceFixture("invoice-drain"); let stopped = false;
  const provider = { ...f.provider, invoice: async (id: string) => { const value = await f.provider.invoice(id); stopped = true; return value; } };
  expect(await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, provider, () => !stopped)).toEqual({ nextCursor: null, interrupted: true });
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 40000 });
  await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, f.provider);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 60000 });
});
it("does not skip a page after a later invoice fails monetary verification", async () => {
  const f = await missedInvoiceFixture("invoice-page-fail"), damaged = f.records[1]!.invoice, amount = damaged.amount_paid;
  damaged.amount_paid = 1;
  await expect(f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, f.provider)).rejects.toThrow("personal_stripe_invoice_mismatch");
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 40000 });
  damaged.amount_paid = amount;
  await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, f.provider);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 60000 });
});
it("advances to the next invoice page only after the entire current page is confirmed", async () => {
  const f = await missedInvoiceFixture("invoice-two-pages"), last = f.records[1]!.invoice.id;
  const provider = { ...f.provider, paidInvoices: vi.fn(async (_subscription: string, cursor?: string) => cursor === last
    ? { data: [f.records[2]!.invoice], hasMore: false }
    : { data: [f.records[0]!.invoice, f.records[1]!.invoice], hasMore: true }) };
  expect(await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, undefined, provider)).toEqual({ nextCursor: last, interrupted: false });
  expect(await f.store.reconcilePaidInvoices(f.snapshots.subscription.id, last, provider)).toEqual({ nextCursor: null, interrupted: false });
  expect(provider.paidInvoices).toHaveBeenNthCalledWith(1, f.snapshots.subscription.id, undefined);
  expect(provider.paidInvoices).toHaveBeenNthCalledWith(2, f.snapshots.subscription.id, last);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 60000 });
});
it("reads fresh cancellation state instead of trusting the subscription event payload", async () => {
  const f = await fixture("fresh-snapshot"), handler = callback(f); await handler.apply();
  f.snapshots.subscription.cancel_at_period_end = true;
  await handler.apply("customer.subscription.updated", { ...f.snapshots.subscription, cancel_at_period_end: false });
  expect(await f.wallet()).toMatchObject({ total_granted: 20000 });
  const row = await asApp(org, async c => (await c.query("SELECT cancel_at_period_end FROM billing_personal_stripe_bindings WHERE purchase_ref=$1", [f.purchase.purchaseRef])).rows[0]);
  expect(row.cancel_at_period_end).toBe(true);
});
it("persists past_due without granting an unpaid latest invoice", async () => {
  const f = await fixture("unpaid"), handler = callback(f);
  f.snapshots.subscription.status = "past_due"; f.snapshots.invoice.status = "open";
  f.snapshots.invoice.amount_paid = 0; f.snapshots.invoice.amount_remaining = f.purchase.product.amountMinor;
  await handler.apply("customer.subscription.updated", f.snapshots.subscription);
  expect(await f.wallet()).toBeUndefined();
  const row = await asApp(org, async c => (await c.query("SELECT status FROM billing_personal_stripe_bindings WHERE purchase_ref=$1", [f.purchase.purchaseRef])).rows[0]);
  expect(row.status).toBe("past_due");
});
it("rejects test/live cross-environment snapshots without financial writes", async () => {
  const f = await fixture("live-mismatch"), handler = callback(f); f.snapshots.invoice.livemode = true;
  await expect(handler.apply()).rejects.toThrow(); expect(await f.wallet()).toBeUndefined();
});
it("ignores old-generation metadata after activation without legacy crediting", async () => {
  const f = await fixture("old-generation"), handler = callback(f); f.snapshots.subscription.metadata.generation = "old";
  await handler.apply(); expect(await f.wallet()).toBeUndefined(); expect(handler.legacy.apply).not.toHaveBeenCalled();
});
it("blocks a second Pro checkout while the original Stripe subscription can still renew", async () => {
  const f = await fixture("still-renewing", false, new Date("2020-01-31T12:00:00Z")); await f.settle();
  await expect(checkout.reserve({ userId: f.userId, orgId: org }, { sku: f.purchase.product.sku, provider: "stripe",
    catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `renewing-${randomUUID()}` }, f.purchase.product)).rejects.toThrow("already_subscribed");
});
it("keeps a webhook-established Checkout identity when the creation response arrives later", async () => {
  const f = await fixture("late-creation"); await f.settle();
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET session_ref=NULL,payment_url=NULL,expires_at=NULL WHERE purchase_ref=$1", [f.purchase.purchaseRef]));
  const result = { sessionRef: "cs_wronglateidentity", url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: new Date(Date.now() + 86400000) };
  await expect(checkout.bind({ userId: f.userId, orgId: org }, f.purchase.purchaseRef, result)).rejects.toThrow("idempotency_conflict");
});
it("recovers through the verified financial binding if the original checkout response never finished binding", async () => {
  const f = await fixture("financial-session-fallback"), handler = callback(f); await f.settle();
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET session_ref=NULL,payment_url=NULL,expires_at=NULL WHERE purchase_ref=$1", [f.purchase.purchaseRef]));
  expect(await handler.store.reconcileSubscription(f.snapshots.subscription.id, handler.provider)).toBe(true);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
});
it("reads annual payment expiry separately from the current monthly quota", async () => {
  const f = await fixture("entitlement-year"), handler = callback(f); await handler.apply();
  const info = await new PgPersonalEntitlementRepository(db).read({ userId: f.userId, orgId: org });
  expect(info).toMatchObject({ plan: "pro", billingCycle: "year", renewalMode: "automatic", paymentProvider: "stripe", status: "active",
    currentPeriodEnd: creditMonthBoundary(f.anchor, 12).toISOString(), cancelAtPeriodEnd: false,
    creditGrant: { status: "granted", grant: { credits: 20000, remainingCredits: 20000, periodEnd: creditMonthBoundary(f.anchor, 1).toISOString() } } });
});
it("does not expose paid entitlement to a different authenticated owner", async () => {
  const f = await fixture("entitlement-other"); await f.settle();
  const info = await new PgPersonalEntitlementRepository(db).read({ userId: `${prefix}-outsider`, orgId: org });
  expect(info).toMatchObject({ plan: null, status: "none", billingCycle: null, renewalMode: null, creditGrant: { status: "none", grant: null } });
});
it("keeps actual past_due state separate from a still-valid paid entitlement", async () => {
  const f = await fixture("entitlement-debt"), handler = callback(f); await handler.apply();
  f.snapshots.subscription.status = "past_due"; f.snapshots.invoice.status = "open";
  await handler.apply("customer.subscription.updated", f.snapshots.subscription);
  const info = await new PgPersonalEntitlementRepository(db).read({ userId: f.userId, orgId: org });
  expect(info).toMatchObject({ plan: "pro", status: "past_due", creditGrant: { status: "granted" } });
});
it("handles signed raw HTTP Stripe callbacks with real HMAC and one financial grant", async () => {
  const f = await fixture("signed-http"), handler = callback(f), secret = "whsec_personal_http_fixture";
  const config = new DeploymentBillingConfig({ BILLING_DEPLOYMENT: "us", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_RETURN_URL: "https://example.test/billing" });
  const service = new BillingStripeWebhookService(new StripeWebhookClient(config), handler.provider, handler.store, { info: vi.fn(), error: vi.fn() });
  const app = await NestFactory.create({ module: class PersonalStripeHttpFixture {}, controllers: [BillingStripeWebhookController],
    providers: [{ provide: BillingStripeWebhookService, useValue: service }] }, { bodyParser: false, logger: false });
  app.use(raw({ type: () => true, limit: "1mb" })); await app.listen(0, "127.0.0.1");
  try {
    const send = async (valid: boolean, timestamp = Math.floor(Date.now() / 1000)) => {
      const body = JSON.stringify({ object: "event", id: `evt_${randomUUID().replaceAll("-", "")}`, type: "invoice.paid",
        data: { object: { ...f.snapshots.invoice, amount_paid: 1 } } }); // Event money is deliberately forged; authenticated reads decide.
      const signature = createHmac("sha256", valid ? secret : "wrong").update(`${timestamp}.${body}`).digest("hex");
      return fetch(`${await app.getUrl()}${operations.stripeWebhook.path}`, { method: "POST", headers: { "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}` }, body });
    };
    expect((await send(false)).status).toBe(400); expect((await send(true, Math.floor(Date.now() / 1000) - 1000)).status).toBe(400);
    expect(await f.wallet()).toBeUndefined();
    expect((await send(true)).status).toBe(200); expect((await send(true)).status).toBe(200);
    expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
  } finally { await app.close(); }
});
async function packCallback() {
  const userId = `${prefix}-pack-${randomUUID().slice(0, 6)}`, principal = { userId, orgId: org }; users.push(userId);
  const product = PERSONAL_PRICE_CATALOG.us[2]!;
  const purchase = await checkout.reserve(principal, { sku: product.sku, provider: "stripe", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION,
    idempotencyKey: `pack-${randomUUID()}` }, product);
  const sessionRef = `cs_${purchase.purchaseRef}`;
  await checkout.bind(principal, purchase.purchaseRef, { sessionRef, url: "https://checkout.stripe.com/c/pay/pack", expiresAt: new Date(Date.now() + 86400000) });
  const session = { object: "checkout.session", id: sessionRef, livemode: false, mode: "payment", status: "complete", payment_status: "paid",
    client_reference_id: purchase.purchaseRef, amount_total: Number(product.amountMinor), currency: product.currency.toLowerCase(),
    payment_intent: `pi_${purchase.purchaseRef}`, metadata: { product: "personal_pricing_v1", purchase_ref: purchase.purchaseRef, generation: purchase.generation, sku: product.sku } };
  const provider = { checkout: async () => session, subscription: async () => { throw Error("unexpected_subscription_lookup"); },
    invoice: async () => { throw Error("unexpected_invoice_lookup"); }, price: async () => { throw Error("unexpected_price_lookup"); } };
  const store = new PersonalStripeWebhookStore(db, { retrieve: provider.checkout, liveMode: () => false }, new PgPersonalPaymentRepository(db), { apply: async () => { throw Error("unexpected_legacy_crediting"); } });
  const apply = () => store.apply({ id: `evt_${randomUUID().replaceAll("-", "")}`, type: "checkout.session.completed", object: { id: sessionRef } }, provider);
  const wallet = () => asApp(org, async c => (await c.query("SELECT balance::text,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId])).rows[0]);
  return { session, apply, wallet, userId };
}
it("credits the Stripe pack once as permanent credits across repeated callbacks", async () => {
  const f = await packCallback(); await f.apply(); await f.apply();
  expect(await f.wallet()).toMatchObject({ balance: "10000.00", total_purchased: 10000 });
  const count = await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$1", [f.userId])).rows[0].n);
  expect(count).toBe(0);
});
it.each([{ amount_total: 1 }, { currency: "cny" }, { payment_intent: "in_wrongkind" }])("rejects an inconsistent paid Stripe pack %j", async patch => {
  const f = await packCallback(); Object.assign(f.session, patch);
  await expect(f.apply()).rejects.toThrow(); expect(await f.wallet()).toBeUndefined();
});
