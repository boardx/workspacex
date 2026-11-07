import { expect, it, vi } from "vitest";
import type { BillingConfigPort } from "../../src/application/billing/billing-config.port";
import { BillingOrderService, type BillingOrderRepository, type OrderDraft, type StripeCreditCheckoutPort } from "../../src/application/billing/billing-order-service";
import { toOrgId } from "../../src/domain/org-id";

const principal = { userId: "market-user", orgId: toOrgId("market-org") };
const cn = { packageId: "credit-cn-10000-v1", region: "cn", currency: "CNY", amountFen: 12900, displayAmount: "¥129.00", baseCredits: 10000, bonusCredits: 0, bonusRate: 0, totalCredits: 10000, ownerType: "both" as const };
const us = { ...cn, packageId: "credit-us-10000-v1", region: "us", currency: "USD", amountFen: 1900, displayAmount: "$19.00" };
function view(draft: OrderDraft, url: string) {
  const { createdBy: _creator, ...order } = draft;
  return { ...order, qrCodeUrl: url };
}
function setup(market: "cn" | "us" | null | undefined, missingMethod = false) {
  const repository: BillingOrderRepository = {
    packages: async () => [cn, us], package: async (_org, id) => {
      const item = [cn, us].find(value => value.packageId === id); return item ? { ...item, enabled: true } : null;
    }, creditEnabled: async () => true,
    insert: async (_owner, draft, qr) => view(draft, qr), scope: async () => null, order: async () => null, close: async () => null,
  };
  const stripeCreate = vi.fn<StripeCreditCheckoutPort["create"]>(async (_owner, draft) => view(draft, "https://checkout.stripe.com/c/pay/market"));
  const native = { createNativeOrder: vi.fn(async () => "weixin://wxpay/bizpayurl?pr=market"), closeNativeOrder: vi.fn(async () => undefined) };
  const service = new BillingOrderService(repository, { findOrgMembership: async () => null }, {
    getPublicConfig: () => ({ enabledProviders: ["wechat", "stripe"] }), ...(missingMethod ? {} : { getPricingMarket: () => market }),
  } as unknown as BillingConfigPort, native, { create: stripeCreate, reconcile: async (_owner, order) => order, cancel: async (_owner, order) => order });
  return { service, stripeCreate, native };
}
it("lists only the deployment market, without trusting caller currency", async () => {
  expect((await setup("us").service.packages(principal, { ownerType: "user" })).items).toEqual([us]);
  expect((await setup("cn").service.packages(principal, { ownerType: "user" })).items).toEqual([cn]);
});
it("creates a USD Stripe order with exact server money and credits", async () => {
  const f = setup("us");
  const result = await f.service.create(principal, { packageId: us.packageId, provider: "stripe", ownerType: "user" });
  expect(result.order).toMatchObject({ currency: "USD", amountFen: 1900, baseCredits: 10000, provider: "stripe", ownerId: principal.userId });
  expect(f.stripeCreate).toHaveBeenCalledTimes(1);
  expect(f.native.createNativeOrder).not.toHaveBeenCalled();
});
it("rejects a foreign-market SKU before contacting payment providers", async () => {
  for (const [market, item] of [["us", cn], ["cn", us]] as const) {
    const f = setup(market);
    await expect(f.service.create(principal, { packageId: item.packageId, provider: "stripe", ownerType: "user" })).rejects.toMatchObject({ code: "package_disabled" });
    expect(f.stripeCreate).not.toHaveBeenCalled();
  }
});
it("rejects USD through WeChat even if a configuration fixture advertises both providers", async () => {
  const f = setup("us");
  await expect(f.service.create(principal, { packageId: us.packageId, provider: "wechat", ownerType: "user" })).rejects.toMatchObject({ code: "package_disabled" });
  expect(f.native.createNativeOrder).not.toHaveBeenCalled();
});
it("fails closed for an explicitly missing market", async () => {
  const f = setup(null);
  await expect(f.service.packages(principal, { ownerType: "user" })).rejects.toMatchObject({ code: "payment_provider_not_configured" });
  await expect(f.service.create(principal, { packageId: us.packageId, provider: "stripe", ownerType: "user" })).rejects.toMatchObject({ code: "payment_provider_not_configured" });
  expect(f.stripeCreate).not.toHaveBeenCalled();
});

it.each([false, true])("fails closed when market config is undefined (method missing: %s)", async missing => {
  const f = setup(undefined, missing);
  await expect(f.service.packages(principal, { ownerType: "user" })).rejects.toMatchObject({ code: "payment_provider_not_configured" });
  await expect(f.service.create(principal, { packageId: cn.packageId, provider: "wechat", ownerType: "user" })).rejects.toMatchObject({ code: "payment_provider_not_configured" });
  expect(f.native.createNativeOrder).not.toHaveBeenCalled();
  expect(f.stripeCreate).not.toHaveBeenCalled();
});
