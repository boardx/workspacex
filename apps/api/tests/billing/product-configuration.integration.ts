import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgBillingOrderRepository } from "../../src/infrastructure/billing/pg-billing-order-repository";
import { PgBillingCatalogRepository } from "../../src/infrastructure/billing/pg-billing-catalog-repository";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { grantDuePersonalTerms } from "../../src/infrastructure/billing/personal-credit-terms";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { toOrgId } from "../../src/domain/org-id";

// Runs in the serial cashier lane: changing catalog configuration cannot race other files.
const id = `configured-${randomUUID().slice(0, 8)}`, orgId = toOrgId(id);
const principal = { userId: `${id}-user`, orgId };
const db = new PgDatabase(appConfig()), catalog = new PgBillingCatalogRepository(db);
const checkout = new PgPersonalCheckoutRepository(db), payments = new PgPersonalPaymentRepository(db);
const sku = "pro-cn-year-v1";
let original: {amount_fen: number; total_credits: number; base_credits: number; bonus_credits: number};
let epoch: {generation: string | null; activated_at: string | null};
// Configuration fixture ownership: beforeAll snapshots the exact SKU; afterAll restores its changed price/quantity columns.
// Epoch fixture ownership: restore the original generation and full-precision timestamp after the serial test.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await seedOrg({orgId, kind: "personal-local", ownerUserId: principal.userId, projectId: `${id}-project`});
  await asOwner(async c => {
    original = (await c.query("SELECT amount_fen,total_credits,base_credits,bonus_credits FROM credit_packages WHERE package_id=$1", [sku])).rows[0];
    epoch = (await c.query("SELECT generation,activated_at::text FROM billing_pricing_epoch WHERE singleton=true")).rows[0];
    await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]);
  });
});
afterAll(async () => {
  try {
    await asOwner(async c => {
      if (original) await c.query("UPDATE credit_packages SET amount_fen=$2,total_credits=$3,base_credits=$4,bonus_credits=$5 WHERE package_id=$1", [sku,original.amount_fen,original.total_credits,original.base_credits,original.bonus_credits]);
      if (epoch) await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton=true", [epoch.generation,epoch.activated_at]);
    });
  } finally { await db.close(); }
});
it("keeps subscription SKUs out of legacy one-time package checkout", async () => {
  const legacy = new PgBillingOrderRepository(db);
  expect(await legacy.package(orgId,sku)).toBeNull();
  const rows = await legacy.packages({orgId,ownerType:"user",ownerId:principal.userId});
  expect(rows.some(row => row.packageId === sku)).toBe(false);
});
it("prices new orders from configuration while paid annual grants retain their purchased quantity", async () => {
  await asOwner(c => c.query("UPDATE credit_packages SET amount_fen=123456,total_credits=23456,base_credits=23456,bonus_credits=0 WHERE package_id=$1", [sku]));
  await expect(asApp(orgId,c => c.query("SELECT package_id FROM credit_packages WHERE package_id=$1 FOR SHARE",[sku]))).rejects.toMatchObject({code:"42501"});
  const first = await catalog.read(principal,"cn");
  expect(first.products.find(p => p.sku===sku)).toMatchObject({amountMinor:123456,monthlyCredits:23456,cycle:"year"});
  const request = {sku, provider:"wechat" as const, catalogVersion:first.version,idempotencyKey:`configuration-${randomUUID()}`};
  const purchase = await checkout.reserve(principal,request,"cn");
  await asOwner(c => c.query("UPDATE credit_packages SET amount_fen=234567,total_credits=34567,base_credits=34567,bonus_credits=0 WHERE package_id=$1", [sku]));
  const changed = await catalog.read(principal,"cn");
  expect(changed.version).not.toBe(first.version);
  expect(changed.products.find(p => p.sku===sku)).toMatchObject({amountMinor:234567,monthlyCredits:34567});
  // A retry retains the order snapshot, even when today's configuration differs.
  expect((await checkout.reserve(principal,request,"cn")).product).toEqual(purchase.product);
  const other = {...principal,userId:`${id}-other`};
  await expect(checkout.reserve(other,{...request,idempotencyKey:`stale-${randomUUID()}`},"cn")).rejects.toThrow("catalog_changed");
  const fresh = await checkout.reserve(other,{...request,catalogVersion:changed.version,idempotencyKey:`fresh-${randomUUID()}`},"cn");
  expect(fresh.product).toMatchObject({amountMinor:234567,monthlyCredits:34567});
  const paidAt = new Date();
  const receipt = {purchaseRef:purchase.purchaseRef,provider:"wechat" as const,paymentRef:`wx_${randomUUID().replaceAll("-", "")}`,amountMinor:123456,currency:"CNY",paidAt};
  await expect(payments.settle({...receipt,amountMinor:234567})).rejects.toThrow("personal_receipt_mismatch");
  expect(await payments.settle(receipt)).toEqual({completed:true,manual:false});
  const next = new Date(creditMonthBoundary(paidAt,1).getTime()+1000);
  await asApp(orgId,c => grantDuePersonalTerms(c,principal.userId,next));
  const periods = await asOwner(async c => (await c.query("SELECT granted_hundredths::text FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$1 ORDER BY period_start",[principal.userId])).rows);
  expect(periods.map(p => p.granted_hundredths)).toEqual(["2345600","2345600"]);
});
