import type { StoredPersonalPurchase } from "../../src/application/billing/personal-checkout-ports";
import { bindPersonalStripeSubscription, verifiedPersonalStripeTerm } from "../../src/domain/billing/personal-stripe-receipt";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";

/** Pinned Clover wire fixture; every amount and cycle derives from the reserved server quote. */
export function personalStripePaymentFixture(purchase: StoredPersonalPurchase, anchor: Date, offset = 0) {
  if (purchase.product.kind !== "subscription") throw Error("fixture_requires_pro");
  const product = purchase.product, suffix = purchase.purchaseRef, sessionRef = purchase.sessionRef ?? `cs_${suffix}`;
  const subscriptionRef = `sub_${suffix}`, customerRef = `cus_${suffix}`, priceRef = `price_${suffix}`;
  const metadata = { product: "personal_pricing_v1", purchase_ref: purchase.purchaseRef, sku: product.sku, generation: purchase.generation };
  const price = { object: "price", id: priceRef, livemode: false, type: "recurring", currency: product.currency.toLowerCase(), unit_amount: Number(product.amountMinor),
    recurring: { interval: product.cycle, interval_count: 1, usage_type: "licensed" } };
  const start = creditMonthBoundary(anchor, offset), end = creditMonthBoundary(anchor, offset + (product.cycle === "year" ? 12 : 1));
  const invoiceRef = `in_${suffix}_${offset}`;
  const checkout = { object: "checkout.session", id: sessionRef, livemode: false, mode: "subscription", status: "complete", payment_status: "paid",
    amount_total: product.amountMinor, currency: product.currency.toLowerCase(), client_reference_id: purchase.purchaseRef, subscription: subscriptionRef,
    customer: customerRef, metadata, invoice: invoiceRef, expires_at: anchor.getTime() / 1000 + 86400, url: null };
  const subscription = { object: "subscription", id: subscriptionRef, livemode: false, customer: customerRef, billing_cycle_anchor: anchor.getTime() / 1000,
    status: "active", cancel_at_period_end: false, latest_invoice: invoiceRef, metadata,
    items: { has_more: false, data: [{ quantity: 1, price: { id: priceRef }, current_period_start: start.getTime() / 1000, current_period_end: end.getTime() / 1000 }] } };
  const invoice = { object: "invoice", id: invoiceRef, livemode: false, customer: customerRef, status: "paid", amount_paid: Number(product.amountMinor),
    amount_due: product.amountMinor, amount_remaining: 0, total: product.amountMinor, currency: product.currency.toLowerCase(),
    billing_reason: offset ? "subscription_cycle" : "subscription_create", status_transitions: { paid_at: start.getTime() / 1000 },
    parent: { type: "subscription_details", subscription_details: { subscription: subscriptionRef } },
    lines: { has_more: false, data: [{ quantity: 1, amount: product.amountMinor, currency: product.currency.toLowerCase(),
      parent: { type: "subscription_item_details", subscription_item_details: { subscription: subscriptionRef, proration: false } },
      pricing: { type: "price_details", price_details: { price: priceRef } }, period: { start: start.getTime() / 1000, end: end.getTime() / 1000 } }] } };
  const proof = (locked: StoredPersonalPurchase = purchase) => {
    const binding = bindPersonalStripeSubscription({ ...locked, sessionRef }, checkout, subscription, price);
    return { binding, term: verifiedPersonalStripeTerm(binding, invoice, price), paidAt: start };
  };
  return { checkout, subscription, price, invoice, proof };
}
