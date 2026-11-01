import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";

const prefix = `purchase-${randomUUID().slice(0, 10)}`, org = toOrgId(prefix);
const db = new PgDatabase(appConfig()), repository = new PgPersonalCheckoutRepository(db), users: string[] = [];
// Intent fixture ownership: repository inserts only the exact recorded user IDs; afterAll deletes those IDs.
// Epoch fixture ownership: this dedicated isolated database is restored to inactive by afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` });
  await activate();
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])", [users]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close();
});
function fixture(label: string, product = PERSONAL_PRICE_CATALOG.us[0]) {
  const principal = { userId: `${prefix}-${label}`, orgId: org }; users.push(principal.userId);
  const request = { sku: product.sku, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, provider: "stripe" as const, idempotencyKey: `purchase-${randomUUID()}` };
  return { principal, request, product, reserve: () => repository.reserve(principal, request, product) };
}
async function activate() {
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
}
it("keeps the new checkout closed until the accounting epoch is explicitly active", async () => {
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  const f = fixture("inactive"); await expect(f.reserve()).rejects.toThrow("dependency_unavailable");
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM billing_personal_purchases WHERE user_id=$1", [f.principal.userId])).rows[0].n)).toBe(0);
  await activate();
});
it("rejects a partial provider binding and prevents changes to the original price", async () => {
  const f = fixture("partial-binding"), row = await f.reserve();
  await expect(asApp(org, c => c.query("UPDATE billing_personal_purchases SET session_ref='cs_partial' WHERE purchase_ref=$1", [row.purchaseRef]))).rejects.toThrow();
  await expect(asApp(org, c => c.query("UPDATE billing_personal_purchases SET product='{}'::jsonb WHERE purchase_ref=$1", [row.purchaseRef]))).rejects.toThrow(/permission denied/);
});
it("persists one server quote and merchant identity under concurrent retries", async () => {
  const f = fixture("concurrent"); const results = await Promise.all([f.reserve(), f.reserve(), f.reserve()]);
  expect(new Set(results.map(row => row.purchaseRef)).size).toBe(1);
  expect(results[0]).toMatchObject({ userId: f.principal.userId, generation: BILLING_ACCOUNTING_GENERATION, product: f.product });
  expect(results[0]!.purchaseRef).toMatch(/^bm\d{14}[A-Za-z0-9]{6}$/);
});
it("rejects changing a SKU, provider or catalog under the same idempotency key", async () => {
  const f = fixture("conflict"); await f.reserve();
  for (const patch of [{ sku: "pro-us-year-v1" }, { provider: "wechat" as const }, { catalogVersion: "another-version" }]) {
    await expect(repository.reserve(f.principal, { ...f.request, ...patch }, f.product)).rejects.toThrow("idempotency_conflict");
  }
});
it("prevents a second simultaneous Pro purchase even with a new key or payment channel", async () => {
  const f = fixture("one-subscription"); await f.reserve();
  await expect(repository.reserve(f.principal, { ...f.request, idempotencyKey: `purchase-${randomUUID()}` }, f.product)).rejects.toThrow("already_subscribed");
});
it("scopes idempotency keys and cached results to the authenticated user", async () => {
  const f = fixture("owner"), other = fixture("other"); const original = await f.reserve();
  expect(await repository.find(other.principal, f.request.idempotencyKey)).toBeNull();
  const own = await repository.reserve(other.principal, f.request, f.product);
  expect(own.purchaseRef).not.toBe(original.purchaseRef);
});
it("keeps one immutable Checkout result and rejects a second provider session", async () => {
  const f = fixture("binding"); const row = await f.reserve();
  const result = { sessionRef: "cs_checkoutbinding", url: "https://checkout.stripe.com/c/pay/bound", expiresAt: new Date(Date.now() + 86400000) };
  await repository.bind(f.principal, row.purchaseRef, result);
  await repository.bind(f.principal, row.purchaseRef, result);
  expect(await repository.find(f.principal, f.request.idempotencyKey)).toMatchObject({ sessionRef: result.sessionRef, url: result.url });
  await expect(repository.bind(f.principal, row.purchaseRef, { ...result, sessionRef: "cs_another" })).rejects.toThrow("idempotency_conflict");
  const other = fixture("cannot-bind");
  await expect(repository.bind(other.principal, row.purchaseRef, result)).rejects.toThrow("product_unavailable");
});
it("retains a confirmed-closed purchase for idempotent reads while allowing a new Pro purchase", async () => {
  const f = fixture("closed"), original = await f.reserve();
  const result = { sessionRef: `cs_${original.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/closed", expiresAt: new Date(Date.now() + 86400000) };
  const bound = await repository.bind(f.principal, original.purchaseRef, result);
  expect(await repository.confirmClosed(bound)).toBe(true);
  const first = await repository.find(f.principal, f.request.idempotencyKey); expect(first?.closedAt).toBeInstanceOf(Date);
  expect(await repository.confirmClosed(bound)).toBe(true);
  expect((await repository.find(f.principal, f.request.idempotencyKey))?.closedAt).toEqual(first?.closedAt);
  const next = await repository.reserve(f.principal, { ...f.request, idempotencyKey: `next-${randomUUID()}` }, f.product);
  expect(next.purchaseRef).not.toBe(original.purchaseRef);
});
it("cannot confirm closure against a different owner or Checkout session", async () => {
  const f = fixture("close-identity"), original = await f.reserve();
  const bound = await repository.bind(f.principal, original.purchaseRef, { sessionRef: `cs_${original.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/closed", expiresAt: new Date(Date.now() + 86400000) });
  for (const patch of [{ userId: "another-user" }, { sessionRef: "cs_wrongclosedidentity" }, { provider: "wechat" as const }]) {
    await expect(repository.confirmClosed({ ...bound, ...patch })).rejects.toThrow("product_unavailable");
  }
  expect((await repository.find(f.principal, f.request.idempotencyKey))?.closedAt).toBeNull();
});
it("keeps fulfilled or manual-review purchases open to financial reconciliation", async () => {
  for (const flag of ["fulfilled_at=clock_timestamp()", "payment_review_required=true"]) {
    const f = fixture(`close-paid-${users.length}`), original = await f.reserve();
    const bound = await repository.bind(f.principal, original.purchaseRef, { sessionRef: `cs_${original.purchaseRef}`, url: "https://checkout.stripe.com/c/pay/closed", expiresAt: new Date(Date.now() + 86400000) });
    // Test-only owned row mutation; app_rw cannot alter immutable purchase data.
    await asOwner(c => c.query(`UPDATE billing_personal_purchases SET ${flag} WHERE purchase_ref=$1`, [original.purchaseRef]));
    expect(await repository.confirmClosed(bound)).toBe(false);
    expect((await repository.find(f.principal, f.request.idempotencyKey))?.closedAt).toBeNull();
  }
});
