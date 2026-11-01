import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CreditBalance } from "@repo/contracts/billing-credits";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { PERSONAL_PAYMENT_SQL } from "../../src/infrastructure/billing/personal-payment-sql";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";
import { toOrgId } from "../../src/domain/org-id";

const prefix = `settle-${randomUUID().slice(0, 9)}`, org = toOrgId(prefix), users: string[] = [];
const db = new PgDatabase(appConfig()), checkout = new PgPersonalCheckoutRepository(db), store = new PgPersonalPaymentRepository(db);
// @global-scope-fixture table:credit_wallets: afterAll deletes only the exact user IDs recorded by fixture().
// All purchases, payment receipts, terms and ledgers are owned by the recorded users and cleaned afterAll.
// Epoch fixture ownership: isolated database marker is restored to inactive afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])", [users]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close();
});
async function fixture(label: string, index = 1, market: "cn" | "us" = "cn") {
  const userId = `${prefix}-${label}`; users.push(userId);
  const product = PERSONAL_PRICE_CATALOG[market][index]!, provider = market === "cn" ? "wechat" as const : "stripe" as const;
  const principal = { userId, orgId: org };
  const purchase = await checkout.reserve(principal, { sku: product.sku, provider, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `settle-${randomUUID()}` }, product);
  const receipt = { purchaseRef: purchase.purchaseRef, provider, paymentRef: `${provider === "wechat" ? "wx" : "pi"}_${randomUUID().replaceAll("-", "")}`,
    amountMinor: product.amountMinor, currency: product.currency, paidAt: new Date() };
  const wallet = () => asApp(org, async c => (await c.query("SELECT balance::text,total_granted,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId])).rows[0]);
  return { userId, principal, purchase, receipt, wallet };
}
it("credits one monthly batch from one annual WeChat payment under concurrent callbacks", async () => {
  const f = await fixture("annual");
  const results = await Promise.all([store.settle(f.receipt), store.settle(f.receipt), store.settle(f.receipt)]);
  expect(results.every(result => result.completed && !result.manual)).toBe(true);
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000, total_purchased: 0 });
  const terms = await asApp(org, async c => (await c.query("SELECT period_start,period_end FROM billing_personal_terms WHERE user_id=$1", [f.userId])).rows);
  expect(terms).toHaveLength(1); expect(terms[0]!.period_start).toEqual(f.receipt.paidAt);
  expect(terms[0]!.period_end).toEqual(creditMonthBoundary(f.receipt.paidAt, 12));
  const batches = await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1", [f.userId])).rows[0].n);
  expect(batches).toBe(1);
});
it.each(["cn", "us"] as const)("permanent %s topups repay debt once without creating an expiring period", async market => {
  const f = await fixture(`pack-${market}`, 2, market);
  await asApp(org, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,-3.25)", [f.userId]));
  await Promise.all([store.settle(f.receipt), store.settle(f.receipt)]);
  expect(await f.wallet()).toMatchObject({ balance: "9996.75", total_purchased: 10000, total_granted: 0 });
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1 AND t.type='purchase'", [f.userId])).rows[0].n)).toBe(1);
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1", [f.userId])).rows[0].n)).toBe(0);
});
it("rejects mismatched amount, currency and provider before any receipt or credit is recorded", async () => {
  const f = await fixture("wrong", 2);
  for (const patch of [{ amountMinor: 1 }, { currency: "USD" }, { provider: "stripe" as const }, { paymentRef: "pi_wrong_channel" }]) await expect(store.settle({ ...f.receipt, ...patch })).rejects.toThrow("personal_receipt_mismatch");
  expect(await f.wallet()).toBeUndefined();
});
it("does not reassign the same verified payment to another purchase or owner", async () => {
  const f = await fixture("original", 2), other = await fixture("other", 2);
  await store.settle(f.receipt);
  await expect(store.settle({ ...other.receipt, paymentRef: f.receipt.paymentRef })).rejects.toThrow("personal_receipt_replay_mismatch");
  expect(await other.wallet()).toBeUndefined();
});
it("does not extend a manual Pro term by replaying its transaction with another payment time", async () => {
  const f = await fixture("time"); await store.settle(f.receipt);
  const later = new PgPersonalPaymentRepository(db, () => new Date(f.receipt.paidAt.getTime() + 2000));
  await expect(later.settle({ ...f.receipt, paidAt: new Date(f.receipt.paidAt.getTime() + 1000) })).rejects.toThrow("personal_receipt_replay_mismatch");
  expect(await f.wallet()).toMatchObject({ balance: "20000.00", total_granted: 20000 });
});
it("rolls receipt, balance and fulfillment back together on a real transaction failure", async () => {
  const f = await fixture("rollback", 2);
  const fault: DatabasePort = { withTenant: db.withTenant.bind(db), close: async () => {}, withoutTenant: run => db.withoutTenant(session => run({
    query(sql, params) { if (sql === PERSONAL_PAYMENT_SQL.personalPackLedger) throw Error("injected_ledger_failure"); return session.query(sql, params); },
  } as TenantSession)) };
  await expect(new PgPersonalPaymentRepository(fault).settle(f.receipt)).rejects.toThrow("injected_ledger_failure");
  expect(await f.wallet()).toBeUndefined();
  expect((await checkout.find(f.principal, f.purchase.idempotencyKey))?.fulfilledAt).toBeNull();
  await store.settle(f.receipt); expect(await f.wallet()).toMatchObject({ balance: "10000.00" });
});
it("retains a capacity failure for manual recovery even after the balance later changes", async () => {
  const f = await fixture("capacity", 2);
  await asApp(org, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,$2)", [f.userId, CreditBalance.maxValue]));
  expect(await store.settle(f.receipt)).toEqual({ completed: true, manual: true });
  await asApp(org, c => c.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='user' AND owner_id=$1", [f.userId]));
  expect(await store.settle(f.receipt)).toEqual({ completed: true, manual: true });
  expect(await f.wallet()).toMatchObject({ balance: "0.00", total_purchased: 0 });
});
it("rolls an ungrantable Pro term back before recording manual recovery", async () => {
  const f = await fixture("pro-capacity");
  await asApp(org, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,$2)", [f.userId, CreditBalance.maxValue]));
  expect(await store.settle(f.receipt)).toEqual({ completed: true, manual: true });
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM billing_personal_terms WHERE user_id=$1", [f.userId])).rows[0].n)).toBe(0);
  expect((await checkout.find(f.principal, f.purchase.idempotencyKey))?.paymentReviewRequired).toBe(true);
  await asApp(org, c => c.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='user' AND owner_id=$1", [f.userId]));
  expect(await store.settle(f.receipt)).toEqual({ completed: true, manual: true });
  expect(await f.wallet()).toMatchObject({ balance: "0.00", total_granted: 0 });
});
it("refuses to credit a payment while the accounting epoch is inactive", async () => {
  const f = await fixture("inactive", 2);
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  try { await expect(store.settle(f.receipt)).rejects.toThrow("dependency_unavailable"); }
  finally { await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION])); }
  expect(await f.wallet()).toBeUndefined();
});
