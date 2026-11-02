import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { StoredPersonalPurchase } from "../../src/application/billing/personal-checkout-ports";
import type { PersonalWechatPaymentState } from "../../src/infrastructure/billing/personal-wechat-payment-client";
import type { StripeSnapshotProvider } from "../../src/application/billing/billing-stripe-webhook-service";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { PersonalPaymentReconciler } from "../../src/infrastructure/billing/personal-payment-reconciler";
import { PersonalStripeWebhookStore } from "../../src/infrastructure/billing/personal-stripe-webhook-store";
import { PgPersonalPaymentRecoveryStore } from "../../src/infrastructure/billing/pg-personal-payment-recovery-store";
import { personalStripePaymentFixture } from "./personal-stripe-payment-fixture";

const prefix = `payment-recovery-${randomUUID().slice(0, 8)}`, org = toOrgId(prefix), users: string[] = [];
const db = new PgDatabase(appConfig()), purchases = new PgPersonalCheckoutRepository(db), payments = new PgPersonalPaymentRepository(db);
// Fixture ownership: all purchases/bindings/receipts/credit rows are deleted by the exact recorded users afterAll.
// Epoch fixture ownership: the dedicated isolated database marker is restored to inactive afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` });
  await activate();
});
afterEach(async () => {
  // Defers only this file's exact owned fixtures so subsequent global sweeps cannot consume earlier test cases.
  await asOwner(async c => {
    await c.query("UPDATE billing_personal_purchases SET recovery_next_check_at='infinity'::timestamptz WHERE user_id=ANY($1::text[])", [users]);
    await c.query("UPDATE billing_personal_stripe_bindings SET next_check_at='infinity'::timestamptz WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))", [users]);
  });
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
function activate() { return asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION])); }
async function purchase(provider: "stripe" | "wechat" = "stripe", pro = false) {
  const userId = `${prefix}-${randomUUID().slice(0, 8)}`; users.push(userId);
  const principal = { userId, orgId: org }, product = PERSONAL_PRICE_CATALOG[provider === "stripe" ? "us" : "cn"][pro ? 0 : 2]!;
  const reserved = await purchases.reserve(principal, { sku: product.sku, provider, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION,
    idempotencyKey: `recovery-${randomUUID()}` }, product);
  const bound = await purchases.bind(principal, reserved.purchaseRef, { sessionRef: provider === "stripe" ? `cs_${reserved.purchaseRef}` : reserved.purchaseRef,
    url: provider === "stripe" ? "https://checkout.stripe.com/c/pay/recovery" : "weixin://wxpay/bizpayurl?pr=recovery", expiresAt: new Date(Date.now() + 86400000) });
  return { principal, purchase: bound };
}
function runtime() {
  const sessions = new Map<string, Record<string, unknown>>();
  const stripe = { liveMode: () => false, retrieve: vi.fn(async (id: string) => {
    const value = sessions.get(id); if (!value) throw Error("fixture_session_missing"); return value;
  }) };
  const wechat = { reconcile: vi.fn(async (): Promise<PersonalWechatPaymentState> => ({ state: "pending" })) };
  const sync = { reconcileCheckout: vi.fn(async () => true), reconcileSubscription: vi.fn(async () => true),
    reconcilePaidInvoices: vi.fn(async () => ({ nextCursor: null as string | null, interrupted: false })) };
  const provider: StripeSnapshotProvider = { checkout: async () => { throw Error("unexpected_snapshot_lookup"); }, subscription: async () => { throw Error("unexpected_snapshot_lookup"); } };
  const logger = { info: vi.fn(), error: vi.fn() }, reconciler = new PersonalPaymentReconciler(stripe, wechat, payments, purchases, sync);
  const store = new PgPersonalPaymentRecoveryStore(db, reconciler, sync, provider, logger);
  const add = (value: StoredPersonalPurchase) => {
    const session = { object: "checkout.session", id: value.sessionRef, mode: value.product.kind === "subscription" ? "subscription" : "payment",
      status: "open", payment_status: "unpaid", livemode: false, client_reference_id: value.purchaseRef,
      amount_total: value.product.amountMinor, currency: value.product.currency.toLowerCase(),
      metadata: { product: "personal_pricing_v1", purchase_ref: value.purchaseRef, generation: value.generation, sku: value.product.sku } };
    sessions.set(value.sessionRef!, session); return session;
  };
  return { sessions, stripe, wechat, sync, provider, logger, reconciler, store, add };
}
const row = (ref: string) => asApp(org, async c => (await c.query("SELECT * FROM billing_personal_purchases WHERE purchase_ref=$1", [ref])).rows[0]);
it("keeps recovery dormant before activation without calling a provider", async () => {
  const f = await purchase(), r = runtime(); r.add(f.purchase);
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  try {
    expect(await r.store.reconcileDue(() => true)).toEqual({ processed: 0, failed: 0 }); expect(r.stripe.retrieve).not.toHaveBeenCalled();
    expect((await row(f.purchase.purchaseRef)).closed_at).toBeNull();
  } finally { await activate(); }
});
it("closes an authoritative expired Stripe session and releases its Pro purchase slot", async () => {
  const f = await purchase("stripe", true), r = runtime(); r.add(f.purchase).status = "expired";
  await r.store.reconcileDue(() => true); expect((await row(f.purchase.purchaseRef)).closed_at).toBeInstanceOf(Date);
  expect((await purchases.reserve(f.principal, { sku: f.purchase.product.sku, provider: "stripe", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION,
    idempotencyKey: `replacement-${randomUUID()}` }, f.purchase.product)).purchaseRef).not.toBe(f.purchase.purchaseRef);
});
it("recovers a missed WeChat callback into one permanent credit grant", async () => {
  const f = await purchase("wechat"), r = runtime(), paidAt = new Date();
  r.wechat.reconcile.mockResolvedValue({ state: "paid", paymentRef: `wx_${f.purchase.purchaseRef}`, paidAt });
  await r.store.reconcileDue(() => true); await r.store.reconcileDue(() => true);
  expect((await row(f.purchase.purchaseRef)).fulfilled_at).toBeInstanceOf(Date);
  const wallet = await asApp(org, async c => (await c.query("SELECT balance::text,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [f.principal.userId])).rows[0]);
  expect(wallet).toMatchObject({ balance: "10000.00", total_purchased: 10000 });
});
it("moves beyond hot failed rows using a bounded fair cursor", async () => {
  const r = runtime(), created = await Promise.all(Array.from({ length: 6 }, () => purchase()));
  const ordered = await asApp(org, async c => (await c.query<{ purchase_ref: string }>("SELECT purchase_ref FROM billing_personal_purchases WHERE purchase_ref=ANY($1::text[]) ORDER BY purchase_ref", [created.map(f => f.purchase.purchaseRef)])).rows);
  const values = ordered.map(row => created.find(f => f.purchase.purchaseRef === row.purchase_ref)!);
  for (const f of values) r.add(f.purchase);
  const first = values[0]!.purchase, last = values[5]!.purchase; r.sessions.delete(first.sessionRef!); r.sessions.get(last.sessionRef!)!.status = "expired";
  expect(await r.store.reconcileDue(() => true)).toMatchObject({ failed: 1 });
  // Reheat the exact first batch so deferral alone cannot fake cursor fairness.
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET recovery_next_check_at=clock_timestamp()-interval '1 second' WHERE purchase_ref=ANY($1::text[])", [values.slice(0, 5).map(f => f.purchase.purchaseRef)]));
  const before = r.stripe.retrieve.mock.calls.length; await r.store.reconcileDue(() => true);
  expect(r.stripe.retrieve.mock.calls.slice(before).map(args => args[0])).toEqual([last.sessionRef]);
  expect((await row(last.purchaseRef)).closed_at).toBeInstanceOf(Date);
});
it("retains an expired unbound intent for manual review instead of creating a new payment", async () => {
  const f = await purchase(), r = runtime();
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET session_ref=NULL,payment_url=NULL,expires_at=NULL,created_at=clock_timestamp()-interval '24 hours' WHERE purchase_ref=$1", [f.purchase.purchaseRef]));
  await r.store.reconcileDue(() => true);
  expect(await row(f.purchase.purchaseRef)).toMatchObject({ payment_review_required: true, closed_at: null, fulfilled_at: null, recovery_error: "binding_unresolved" });
  expect(r.stripe.retrieve).not.toHaveBeenCalled(); expect(r.sync.reconcileCheckout).not.toHaveBeenCalled();
});
it("fails closed for an unknown accounting generation without provider calls", async () => {
  const r = runtime(); await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation='future-billing-generation',activated_at=clock_timestamp() WHERE singleton=true"));
  try { await expect(r.store.reconcileDue(() => true)).rejects.toThrow("dependency_unavailable"); expect(r.stripe.retrieve).not.toHaveBeenCalled(); }
  finally { await activate(); }
});
it("synchronizes a due Stripe binding and every missed paid month, then defers the next poll", async () => {
  const f = await purchase("stripe", true), r = runtime(), anchor = new Date("2026-08-31T12:00:00Z");
  // Test-only accounting clock; normal application code cannot rewrite purchase.created_at.
  await asOwner(c => c.query("UPDATE billing_personal_purchases SET created_at=$2 WHERE purchase_ref=$1", [f.purchase.purchaseRef, anchor]));
  const original = personalStripePaymentFixture(f.purchase, anchor);
  await new PgPersonalPaymentRepository(db, () => new Date(anchor.getTime() + 1000)).settleStripe(f.purchase.purchaseRef, original.subscription.id, original.invoice.id, async locked => original.proof(locked));
  const records = [2, 1, 0].map(offset => personalStripePaymentFixture(f.purchase, anchor, offset));
  const provider = { checkout: async () => original.checkout, subscription: vi.fn(async () => records[0]!.subscription), price: async () => original.price,
    invoice: async (id: string) => { const value = records.find(record => record.invoice.id === id)?.invoice; if (!value) throw Error("fixture_invoice_missing"); return value; },
    paidInvoices: async () => ({ data: records.map(record => record.invoice), hasMore: false }) };
  const sync = new PersonalStripeWebhookStore(db, { retrieve: provider.checkout, liveMode: () => false },
    new PgPersonalPaymentRepository(db, () => new Date("2026-11-01T12:00:00Z")), { apply: async () => { throw Error("unexpected_legacy_poll"); } });
  await asOwner(c => c.query("UPDATE billing_personal_stripe_bindings SET next_check_at=clock_timestamp()-interval '1 second' WHERE subscription_ref=$1", [original.subscription.id]));
  const store = new PgPersonalPaymentRecoveryStore(db, r.reconciler, sync, provider, r.logger);
  expect(await store.reconcileDue(() => true)).toEqual({ processed: 1, failed: 0 });
  const wallet = await asApp(org, async c => (await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [f.principal.userId])).rows[0]);
  expect(wallet).toMatchObject({ balance: "20000.00", total_granted: 60000 });
  const hint = await asApp(org, async c => (await c.query("SELECT invoice_cursor,next_check_at>clock_timestamp() AS deferred FROM billing_personal_stripe_bindings WHERE subscription_ref=$1", [original.subscription.id])).rows[0]);
  expect(hint).toEqual({ invoice_cursor: null, deferred: true });
  const reads = provider.subscription.mock.calls.length;
  expect(await store.reconcileDue(() => true)).toEqual({ processed: 0, failed: 0 }); expect(provider.subscription).toHaveBeenCalledTimes(reads);
});
