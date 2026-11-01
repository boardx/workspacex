import { expect, it } from "vitest";
import { bindPersonalStripeSubscription, verifiedPersonalStripeTerm } from "../../src/domain/billing/personal-stripe-receipt";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";

const anchor = new Date("2027-01-31T12:00:00.000Z");
const seconds = (at: Date) => at.getTime() / 1000;
function fixture(year = false, offset = 0) {
  const product = PERSONAL_PRICE_CATALOG.us[year ? 1 : 0];
  const purchase = { purchaseRef: "bm20261102010000ABC123", userId: "buyer", provider: "stripe" as const,
    generation: BILLING_ACCOUNTING_GENERATION, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, product, createdAt: anchor, sessionRef: "cs_personal" };
  const metadata = { product: "personal_pricing_v1", purchase_ref: purchase.purchaseRef, sku: product.sku, generation: purchase.generation };
  const price = { object: "price", id: "price_personal", type: "recurring", currency: "usd", unit_amount: Number(product.amountMinor),
    recurring: { interval: product.cycle, interval_count: 1, usage_type: "licensed" } };
  const checkout = { object: "checkout.session", id: purchase.sessionRef, mode: "subscription", status: "complete", payment_status: "paid",
    amount_total: product.amountMinor, currency: "usd", client_reference_id: purchase.purchaseRef, subscription: "sub_personal", customer: "cus_personal", metadata };
  const subscription = { object: "subscription", id: "sub_personal", customer: "cus_personal", billing_cycle_anchor: seconds(anchor), metadata,
    items: { has_more: false, data: [{ quantity: 1, price: { id: price.id } }] } };
  const line = { quantity: 1, amount: product.amountMinor, currency: "usd",
    parent: { type: "subscription_item_details", subscription_item_details: { subscription: subscription.id, proration: false } },
    pricing: { type: "price_details", price_details: { price: price.id } },
    period: { start: seconds(creditMonthBoundary(anchor, offset)), end: seconds(creditMonthBoundary(anchor, offset + (year ? 12 : 1))) } };
  const invoice = { object: "invoice", id: "in_personal", customer: subscription.customer, status: "paid", amount_paid: Number(product.amountMinor),
    amount_due: product.amountMinor, amount_remaining: 0, total: product.amountMinor, currency: "usd",
    billing_reason: offset ? "subscription_cycle" : "subscription_create",
    parent: { type: "subscription_details", subscription_details: { subscription: subscription.id } },
    lines: { has_more: false, data: [line] } };
  return { purchase, checkout, subscription, price, invoice, line };
}
it.each([false, true])("binds the full server purchase chain and records only the paid term (%s)", year => {
  const f = fixture(year); const binding = bindPersonalStripeSubscription(f.purchase, f.checkout, f.subscription, f.price);
  const term = verifiedPersonalStripeTerm(binding, f.invoice, f.price);
  expect(term).toMatchObject({ userId: "buyer", provider: "stripe", paymentRef: "in_personal", subscriptionRef: "sub_personal",
    sku: f.purchase.product.sku, amountMinor: f.purchase.product.amountMinor, currency: "USD", purchaseAnchor: anchor, monthOffset: 0, periodStart: anchor });
  expect(term.periodEnd).toEqual(creditMonthBoundary(anchor, year ? 12 : 1));
});
it.each([1, 2, 12])("preserves Jan31 across a renewal at month offset %s", offset => {
  const f = fixture(false, offset); const binding = bindPersonalStripeSubscription(f.purchase, f.checkout, f.subscription, f.price);
  const term = verifiedPersonalStripeTerm(binding, f.invoice, f.price);
  expect(term.monthOffset).toBe(offset); expect(term.purchaseAnchor).toEqual(anchor);
  expect(term.periodEnd).toEqual(creditMonthBoundary(anchor, offset + 1));
});
it("rejects a monthly-renewal date that drifts after February", () => {
  const f = fixture(false, 1); f.line.period.end = seconds(new Date("2027-03-28T12:00:00Z"));
  const binding = bindPersonalStripeSubscription(f.purchase, f.checkout, f.subscription, f.price);
  expect(() => verifiedPersonalStripeTerm(binding, f.invoice, f.price)).toThrow();
});
it.each(["wrong-session", "wrong-owner-ref", "wrong-subscription", "wrong-customer", "wrong-generation", "wrong-price", "two-items", "unpaid"])("rejects unbound initial subscription: %s", fault => {
  const f = fixture();
  if (fault === "wrong-session") f.checkout.id = "cs_another";
  if (fault === "wrong-owner-ref") f.checkout.client_reference_id = "another-purchase";
  if (fault === "wrong-subscription") f.checkout.subscription = "sub_another";
  if (fault === "wrong-customer") f.checkout.customer = "cus_another";
  if (fault === "wrong-generation") f.subscription.metadata.generation = "legacy-generation";
  if (fault === "wrong-price") f.price.unit_amount = 1;
  if (fault === "two-items") f.subscription.items.data.push(f.subscription.items.data[0]!);
  if (fault === "unpaid") f.checkout.payment_status = "unpaid";
  expect(() => bindPersonalStripeSubscription(f.purchase, f.checkout, f.subscription, f.price)).toThrow();
});
it.each(["wrong-currency", "underpaid", "wrong-subscription", "wrong-customer", "proration", "partial-lines", "extra-line", "changed-price", "unsupported-reason", "incorrect-annual-start"])("rejects invalid paid invoice: %s", fault => {
  const f = fixture(true); const binding = bindPersonalStripeSubscription(f.purchase, f.checkout, f.subscription, f.price);
  if (fault === "wrong-currency") f.invoice.currency = "cny";
  if (fault === "underpaid") f.invoice.amount_paid = 1;
  if (fault === "wrong-subscription") f.invoice.parent.subscription_details.subscription = "sub_another";
  if (fault === "wrong-customer") f.invoice.customer = "cus_another";
  if (fault === "proration") f.line.parent.subscription_item_details.proration = true;
  if (fault === "partial-lines") f.invoice.lines.has_more = true;
  if (fault === "extra-line") f.invoice.lines.data.push(f.line);
  if (fault === "changed-price") f.price.unit_amount = 1;
  if (fault === "unsupported-reason") f.invoice.billing_reason = "subscription_update";
  if (fault === "incorrect-annual-start") { f.invoice.billing_reason = "subscription_cycle"; f.line.period.start = seconds(creditMonthBoundary(anchor, 1)); }
  expect(() => verifiedPersonalStripeTerm(binding, f.invoice, f.price)).toThrow();
});
