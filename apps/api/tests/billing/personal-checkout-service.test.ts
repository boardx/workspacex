import { expect, it } from "vitest";
import { PersonalCheckoutService } from "../../src/application/billing/personal-checkout-service";
import type { PersonalCheckoutRepository, StoredPersonalPurchase, PersonalCheckoutBinding } from "../../src/application/billing/personal-checkout-ports";
import type { BillingConfigPort } from "../../src/application/billing/billing-config.port";
import { PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { toOrgId } from "../../src/domain/org-id";

const principal = { userId: "checkout-user", orgId: toOrgId("checkout-org") };
const request = { sku: "pro-us-year-v1", provider: "stripe" as const, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: "checkout-fixture-0001" };
function fixture() {
  let stored: StoredPersonalPurchase | null = null, enabled = true, timeout = false, calls = 0;
  const identities: string[] = [];
  const config: BillingConfigPort = { getPricingMarket: () => "us", getPublicConfig: () => ({ enabledProviders: enabled ? ["stripe", "wechat"] : [] }) };
  const repository: PersonalCheckoutRepository = {
    async find(_principal, key) { return stored?.idempotencyKey === key ? stored : null; },
    async reserve(_principal, input, product) {
      stored ??= { purchaseRef: "bm20261102010000ABC123", userId: principal.userId, provider: input.provider,
        idempotencyKey: input.idempotencyKey, generation: BILLING_ACCOUNTING_GENERATION, catalogVersion: input.catalogVersion, product,
        createdAt: new Date(), sessionRef: null, url: null, expiresAt: null, fulfilledAt: null, closedAt: null, paymentReviewRequired: false };
      return stored;
    },
    async bind(_principal, _id, result: PersonalCheckoutBinding) { stored = { ...stored!, ...result }; return stored; },
  };
  const provider = { enabled: () => enabled, async create(purchase: StoredPersonalPurchase) {
    calls++; identities.push(purchase.purchaseRef); if (timeout) throw Error("fixture_network_timeout");
    return { sessionRef: "cs_checkout", url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: new Date(purchase.createdAt.getTime() + 86400000) };
  } };
  const service = new PersonalCheckoutService(repository, config, provider);
  return { service, disable: () => { enabled = false; }, timeOut: (value: boolean) => { timeout = value; },
    calls: () => calls, identities, stored: () => stored };
}
it("uses server currency, annual price and automatic renewal instead of browser money", async () => {
  const f = fixture(); const result = await f.service.checkout(principal, request);
  expect(result).toMatchObject({ provider: "stripe", renewalMode: "automatic", purchaseRef: "bm20261102010000ABC123" });
  expect(f.stored()?.product).toMatchObject({ sku: "pro-us-year-v1", amountMinor: 29000, currency: "USD", cycle: "year" });
  await expect(f.service.checkout(principal, { ...request, amountMinor: 1 })).rejects.toThrow();
  expect(f.calls()).toBe(1);
});
it("returns the first durable result when sales are disabled after a purchase", async () => {
  const f = fixture(); const first = await f.service.checkout(principal, request); f.disable();
  expect(await f.service.checkout(principal, request)).toEqual(first); expect(f.calls()).toBe(1);
});
it("retains the same purchase identity across an upstream timeout", async () => {
  const f = fixture(); f.timeOut(true);
  await expect(f.service.checkout(principal, request)).rejects.toThrow("dependency_unavailable");
  f.timeOut(false); await f.service.checkout(principal, request);
  expect(f.identities).toEqual(["bm20261102010000ABC123", "bm20261102010000ABC123"]);
});
it("rejects a conflicting replay before creating or redirecting another payment", async () => {
  const f = fixture(); await f.service.checkout(principal, request);
  await expect(f.service.checkout(principal, { ...request, sku: "pro-us-month-v1" })).rejects.toThrow("idempotency_conflict");
  expect(f.calls()).toBe(1);
});
it.each([
  { patch: { catalogVersion: "old-catalog" }, error: "catalog_changed" },
  { patch: { sku: "pro-cn-year-v1" }, error: "product_unavailable" },
  { patch: { provider: "wechat" as const }, error: "product_unavailable" },
])("rejects stale quotes and foreign market products: $error", async ({ patch, error }) => {
  const f = fixture(); await expect(f.service.checkout(principal, { ...request, ...patch })).rejects.toThrow(error); expect(f.calls()).toBe(0);
});
it("does not reserve a new purchase when new sales are disabled", async () => {
  const f = fixture(); f.disable();
  await expect(f.service.checkout(principal, request)).rejects.toThrow("payment_provider_not_configured");
  expect(f.stored()).toBeNull(); expect(f.calls()).toBe(0);
});
it.each([
 {label:"fulfilled",patch:{fulfilledAt:new Date()}},
 {label:"closed",patch:{closedAt:new Date()}},
 {label:"manual review",patch:{paymentReviewRequired:true}},
])("recovers a $label purchase without original payment binding or another provider call",async({patch})=>{
 const f=fixture();f.timeOut(true);await expect(f.service.checkout(principal,request)).rejects.toThrow("dependency_unavailable");
 Object.assign(f.stored()!,patch);f.disable();f.timeOut(false);const before=f.calls();
 expect(await f.service.checkout(principal,request)).toEqual({purchaseRef:f.stored()!.purchaseRef,url:null,expiresAt:null,provider:"stripe",renewalMode:"automatic"});
 expect(f.calls()).toBe(before);
 for(const changed of [{sku:"pro-us-month-v1"},{provider:"wechat"},{catalogVersion:"a-different-catalog"}])await expect(f.service.checkout(principal,{...request,...changed})).rejects.toThrow("idempotency_conflict");
 expect(f.calls()).toBe(before);
});
it("preserves a known terminal binding and never recreates it after the provider retry window",async()=>{
 const f=fixture(),first=await f.service.checkout(principal,request);Object.assign(f.stored()!,{fulfilledAt:new Date(),createdAt:new Date(0)});f.disable();
 expect(await f.service.checkout(principal,request)).toEqual(first);expect(f.calls()).toBe(1);
});
