import { expect, it, vi } from "vitest";
import type { StoredPersonalPurchase } from "../../src/application/billing/personal-checkout-ports";
import type { PersonalWechatPaymentState } from "../../src/infrastructure/billing/personal-wechat-payment-client";
import { PersonalPaymentReconciler } from "../../src/infrastructure/billing/personal-payment-reconciler";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
function fixture(provider: "stripe" | "wechat" = "stripe") {
  const purchase: StoredPersonalPurchase = { purchaseRef: "bm20261102010000ABC123", userId: "recovery-user", provider,
    generation: BILLING_ACCOUNTING_GENERATION, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: "recovery-fixture-key",
    product: PERSONAL_PRICE_CATALOG[provider === "stripe" ? "us" : "cn"][1]!, createdAt: new Date("2020-01-01T00:00:00Z"),
    sessionRef: provider === "stripe" ? "cs_recovery" : "bm20261102010000ABC123", url: "https://checkout.stripe.com/c/pay/fixture",
    expiresAt: new Date("2020-01-02T00:00:00Z"), fulfilledAt: null, closedAt: null, paymentReviewRequired: false };
  const snapshot: Record<string, unknown> = { object: "checkout.session", id: purchase.sessionRef, mode: "subscription", status: "open", payment_status: "unpaid", livemode: false,
    amount_total: purchase.product.amountMinor, currency: purchase.product.currency.toLowerCase(), client_reference_id: purchase.purchaseRef,
    metadata: { product: "personal_pricing_v1", purchase_ref: purchase.purchaseRef, generation: purchase.generation, sku: purchase.product.sku } };
  const stripe = { retrieve: vi.fn(async () => snapshot), liveMode: () => false };
  const wechat = { reconcile: vi.fn(async (): Promise<PersonalWechatPaymentState> => ({ state: "pending" })) };
  const payments = { settle: vi.fn(async () => ({ completed: true as const, manual: false })) };
  const purchases = { confirmClosed: vi.fn(async () => true) };
  const synchronize = { reconcileCheckout: vi.fn(async () => true) };
  return { purchase, snapshot, stripe, wechat, payments, purchases, synchronize,
    reconciler: new PersonalPaymentReconciler(stripe, wechat, payments, purchases, synchronize) };
}
it("never closes a still-open Stripe session just because its local timer expired", async () => {
  const f = fixture(); expect(await f.reconciler.reconcile(f.purchase)).toBe("pending"); expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
it("closes only the matching authoritative expired Stripe session", async () => {
  const f = fixture(); f.snapshot.status = "expired";
  expect(await f.reconciler.reconcile(f.purchase)).toBe("closed"); expect(f.purchases.confirmClosed).toHaveBeenCalledWith(f.purchase);
});
it.each([{ amount_total: 1 }, { currency: "cny" }, { livemode: true }, { id: "cs_another" }, { metadata: {} }])("rejects inconsistent closure evidence %j", async patch => {
  const f = fixture(); Object.assign(f.snapshot, { status: "expired" }, patch);
  await expect(f.reconciler.reconcile(f.purchase)).rejects.toThrow(); expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
it("recovers a complete Stripe Checkout using authoritative settlement, without inventing a signed event", async () => {
  const f = fixture(); Object.assign(f.snapshot, { status: "complete", payment_status: "paid" });
  expect(await f.reconciler.reconcile(f.purchase)).toBe("paid"); expect(f.synchronize.reconcileCheckout).toHaveBeenCalledWith("cs_recovery");
  expect(f.payments.settle).not.toHaveBeenCalled(); expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
it("does not acknowledge a Stripe synchronization that still requires retry", async () => {
  const f = fixture(); Object.assign(f.snapshot, { status: "complete", payment_status: "paid" }); f.synchronize.reconcileCheckout.mockResolvedValue(false);
  await expect(f.reconciler.reconcile(f.purchase)).rejects.toThrow();
});
it("does not create another payment identity for an unresolved unbound purchase", async () => {
  const f = fixture(); expect(await f.reconciler.reconcile({ ...f.purchase, sessionRef: null })).toBe("unbound");
  expect(f.stripe.retrieve).not.toHaveBeenCalled(); expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
it("credits the authoritative paid WeChat order when payment wins its closure race", async () => {
  const f = fixture("wechat"), paidAt = new Date("2026-11-01T10:00:00Z");
  f.wechat.reconcile.mockResolvedValue({ state: "paid", paymentRef: "wx_recovered", paidAt });
  expect(await f.reconciler.reconcile(f.purchase)).toBe("paid");
  expect(f.payments.settle).toHaveBeenCalledWith({ provider: "wechat", purchaseRef: f.purchase.purchaseRef, paymentRef: "wx_recovered", paidAt,
    amountMinor: f.purchase.product.amountMinor, currency: "CNY" });
  expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
it("does not close WeChat after a failed or pending authoritative read", async () => {
  const f = fixture("wechat"); expect(await f.reconciler.reconcile(f.purchase)).toBe("pending");
  f.wechat.reconcile.mockRejectedValue(Error("merchant_unavailable")); await expect(f.reconciler.reconcile(f.purchase)).rejects.toThrow();
  expect(f.purchases.confirmClosed).not.toHaveBeenCalled();
});
