import { describe, expect, it } from "vitest";
import { PersonalCheckoutRequest, PersonalCheckoutResult, PricingCatalog, PricingSubscriptionInfo, WelcomeCreditGrant } from "../src/billing-pricing";

const catalog = {
  version: "pricing-2026-11-v1", market: "cn", enabledProviders: ["wechat"],
  products: [
    { sku: "pro-cn-month-v1", kind: "subscription", currency: "CNY", amountMinor: 19900, cycle: "month", monthlyCredits: 20000 },
    { sku: "credit-cn-10000-v1", kind: "credit_topup", currency: "CNY", amountMinor: 12900, credits: 10000 },
  ],
};
describe("personal pricing contract design", () => {
  it("accepts server catalog snapshots, rejects mismatched market currency and duplicate SKUs", () => {
    expect(PricingCatalog.parse(catalog)).toEqual(catalog);
    expect(PricingCatalog.safeParse({ ...catalog, market: "us" }).success).toBe(false);
    expect(PricingCatalog.safeParse({ ...catalog, products: [...catalog.products, catalog.products[0]] }).success).toBe(false);
  });
  it("requires integer minor units and the confirmed Pro monthly entitlement", () => {
    for (const patch of [{ amountMinor: 199.5 }, { amountMinor: -1 }, { monthlyCredits: 240000 }]) {
      expect(PricingCatalog.safeParse({ ...catalog, products: [{ ...catalog.products[0], ...patch }] }).success).toBe(false);
    }
  });
  it("only accepts server SKU and version, never caller amounts, credit quantities or owner identity", () => {
    const input = { sku: "pro-cn-month-v1", catalogVersion: catalog.version, provider: "wechat", idempotencyKey: "purchase-intent-0001" };
    expect(PersonalCheckoutRequest.parse(input)).toEqual(input);
    for (const patch of [{ amountMinor: 1 }, { credits: 999999 }, { ownerId: "another-user" }, { provider: "cash" }]) {
      expect(PersonalCheckoutRequest.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it("separates yearly payment from monthly credit period and ties renewal to provider", () => {
    const value = {
      status: "active", planRef: "pro-us-year-v1", currentPeriodEnd: "2027-11-01T10:00:00Z", cancelAtPeriodEnd: false,
      plan: "pro", billingCycle: "year", renewalMode: "automatic", paymentProvider: "stripe",
      welcomeCreditGrant: { status: "none", grant: null },
      creditGrant: { status: "granted", grant: { credits: 20000, remainingCredits: 15000, periodStart: "2026-11-01T10:00:00Z", periodEnd: "2026-12-01T10:00:00Z" } },
    };
    expect(PricingSubscriptionInfo.safeParse(value).success).toBe(true);
    expect(PricingSubscriptionInfo.safeParse({ ...value, paymentProvider: "wechat" }).success).toBe(false);
    expect(PricingSubscriptionInfo.safeParse({ ...value, paymentProvider: "wechat", renewalMode: "manual", cancelAtPeriodEnd: true }).success).toBe(true);
    expect(PricingSubscriptionInfo.safeParse({ ...value, purchaseMode: "manual_monthly" }).success).toBe(false);
    expect(PricingSubscriptionInfo.safeParse({ ...value, creditGrant: { status: "granted", grant: { ...value.creditGrant.grant, periodEnd: value.currentPeriodEnd } } }).success).toBe(false);
  });
  it("checkout returns pending payment, never granted entitlement", () => {
    const result = { purchaseRef: "purchase-0001", url: "https://checkout.stripe.com/c/pay/test", expiresAt: "2026-11-01T11:00:00Z", provider: "stripe", renewalMode: "automatic" };
    expect(PersonalCheckoutResult.safeParse(result).success).toBe(true);
    expect(PersonalCheckoutResult.safeParse({ ...result, grantedCredits: 20000 }).success).toBe(false);
  });
  it("welcome credits expire exactly 30 days after grant and expired grants have zero remaining", () => {
    const grant = { credits: 1000, remainingCredits: 1000, grantedAt: "2026-11-01T10:00:00Z", expiresAt: "2026-12-01T10:00:00Z" };
    expect(WelcomeCreditGrant.safeParse({ status: "granted", grant }).success).toBe(true);
    expect(WelcomeCreditGrant.safeParse({ status: "granted", grant: { ...grant, expiresAt: "2026-12-02T10:00:00Z" } }).success).toBe(false);
    expect(WelcomeCreditGrant.safeParse({ status: "expired", grant }).success).toBe(false);
    expect(WelcomeCreditGrant.safeParse({ status: "expired", grant: { ...grant, remainingCredits: 0 } }).success).toBe(true);
    expect(WelcomeCreditGrant.safeParse({ status: "none", grant }).success).toBe(false);
  });
  it("requires explicit new entitlement facts instead of inferring the plan from incomplete state", () => {
    const legacy = { status: "none", planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    expect(PricingSubscriptionInfo.safeParse(legacy).success).toBe(false);
    expect(PricingSubscriptionInfo.safeParse({ ...legacy, plan: null, billingCycle: null, renewalMode: null, welcomeCreditGrant: { status: "none", grant: null } }).success).toBe(true);
  });
});
