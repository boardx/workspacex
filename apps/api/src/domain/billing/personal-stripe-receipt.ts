import type { PersonalPurchase } from "./personal-purchase";
import { BILLING_ACCOUNTING_GENERATION } from "./billing-generation";
import { PERSONAL_PAYMENT_PRODUCT } from "./personal-payment-product";
import { creditMonthBoundary, paidCreditMonthCount } from "./personal-credit-calendar";

type ProProduct = Extract<PersonalPurchase["product"], { kind: "subscription" }>;
export type PersonalStripeBinding = Omit<PersonalPurchase, "product" | "provider"> & Readonly<{
  product: ProProduct; provider: "stripe"; sessionRef: string; subscriptionRef: string;
  customerRef: string; priceRef: string; purchaseAnchor: Date;
}>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("personal_stripe_object_invalid");
  return value as Record<string, unknown>;
}
function reference(value: unknown, prefix: string): string {
  if (typeof value !== "string" || value.length > 255 || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) throw Error("personal_stripe_reference_invalid");
  return value;
}
function timestamp(value: unknown): Date {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 253402300799) throw Error("personal_stripe_timestamp_invalid");
  return new Date(value * 1000);
}
function matchingPrice(price: Record<string, unknown>, product: ProProduct, priceRef: string) {
  const recurring = object(price.recurring);
  if (price.object !== "price" || price.id !== priceRef || price.type !== "recurring" || price.currency !== product.currency.toLowerCase() ||
    price.unit_amount !== product.amountMinor || recurring.interval !== product.cycle || recurring.interval_count !== 1 || recurring.usage_type !== "licensed") throw Error("personal_stripe_price_mismatch");
}
/** Only authoritative provider reads reach this function; metadata never chooses a user. */
export function bindPersonalStripeSubscription(purchase: PersonalPurchase & { sessionRef: string }, checkout: Record<string, unknown>, subscription: Record<string, unknown>, price: Record<string, unknown>): PersonalStripeBinding {
  if (purchase.provider !== "stripe" || purchase.generation !== BILLING_ACCOUNTING_GENERATION || purchase.product.kind !== "subscription") throw Error("personal_stripe_purchase_invalid");
  const product = purchase.product;
  const metadata = { product: PERSONAL_PAYMENT_PRODUCT, purchase_ref: purchase.purchaseRef, generation: purchase.generation, sku: product.sku };
  for (const source of [checkout, subscription]) {
    const actual = object(source.metadata);
    if (Object.entries(metadata).some(([key, value]) => actual[key] !== value)) throw Error("personal_stripe_metadata_mismatch");
  }
  const subscriptionRef = reference(subscription.id, "sub"), customerRef = reference(subscription.customer, "cus");
  const items = object(subscription.items);
  if (subscription.object !== "subscription" || items.has_more !== false || !Array.isArray(items.data) || items.data.length !== 1) throw Error("personal_stripe_subscription_invalid");
  const item = object(items.data[0]), priceRef = reference(object(item.price).id, "price");
  matchingPrice(price, product, priceRef);
  if (item.quantity !== 1 || checkout.object !== "checkout.session" || checkout.id !== reference(purchase.sessionRef, "cs") ||
    checkout.mode !== "subscription" || checkout.status !== "complete" || checkout.payment_status !== "paid" ||
    checkout.client_reference_id !== purchase.purchaseRef || checkout.subscription !== subscriptionRef || checkout.customer !== customerRef ||
    checkout.amount_total !== product.amountMinor || checkout.currency !== product.currency.toLowerCase()) throw Error("personal_stripe_checkout_mismatch");
  return { ...purchase, product, provider: "stripe", subscriptionRef, customerRef, priceRef, purchaseAnchor: timestamp(subscription.billing_cycle_anchor) };
}

/** A paid invoice, rather than an active subscription event, proves one complete paid term. */
export function verifiedPersonalStripeTerm(binding: PersonalStripeBinding, invoice: Record<string, unknown>, price: Record<string, unknown>) {
  const product = binding.product, parent = object(invoice.parent);
  matchingPrice(price, product, binding.priceRef);
  if (binding.generation !== BILLING_ACCOUNTING_GENERATION || invoice.object !== "invoice" || invoice.customer !== binding.customerRef ||
    parent.type !== "subscription_details" || object(parent.subscription_details).subscription !== binding.subscriptionRef ||
    invoice.status !== "paid" || invoice.amount_paid !== product.amountMinor || invoice.amount_due !== product.amountMinor ||
    invoice.total !== product.amountMinor || invoice.amount_remaining !== 0 || invoice.currency !== product.currency.toLowerCase() ||
    !["subscription_create", "subscription_cycle"].includes(String(invoice.billing_reason))) throw Error("personal_stripe_invoice_mismatch");
  const lines = object(invoice.lines);
  if (lines.has_more !== false || !Array.isArray(lines.data) || lines.data.length !== 1) throw Error("personal_stripe_invoice_lines_invalid");
  const line = object(lines.data[0]), lineParent = object(line.parent), detail = object(lineParent.subscription_item_details);
  const pricing = object(line.pricing), period = object(line.period);
  if (line.quantity !== 1 || line.amount !== product.amountMinor || line.currency !== product.currency.toLowerCase() ||
    lineParent.type !== "subscription_item_details" || detail.proration !== false || detail.subscription !== binding.subscriptionRef ||
    pricing.type !== "price_details" || object(pricing.price_details).price !== binding.priceRef) throw Error("personal_stripe_invoice_line_mismatch");
  const start = timestamp(period.start), end = timestamp(period.end), anchor = binding.purchaseAnchor;
  const offset = (start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + start.getUTCMonth() - anchor.getUTCMonth();
  const count = paidCreditMonthCount(product.cycle);
  if (offset < 0 || offset % count !== 0 || start.getTime() !== creditMonthBoundary(anchor, offset).getTime() ||
    end.getTime() !== creditMonthBoundary(anchor, offset + count).getTime() ||
    (invoice.billing_reason === "subscription_create" ? offset !== 0 : offset === 0)) throw Error("personal_stripe_paid_period_mismatch");
  return { userId: binding.userId, provider: "stripe" as const, paymentRef: reference(invoice.id, "in"), subscriptionRef: binding.subscriptionRef,
    sku: product.sku, currency: product.currency, amountMinor: product.amountMinor, purchaseAnchor: anchor, monthOffset: offset, periodStart: start, periodEnd: end };
}
