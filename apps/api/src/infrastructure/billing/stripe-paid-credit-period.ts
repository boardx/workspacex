import type {SubscriptionStatus} from "@repo/contracts/billing-subscription";

export type PaidCreditPeriod = {subscriptionRef: string; invoiceRef: string; planRef: string; periodStart: Date; periodEnd: Date};
type Subject = {subscriptionRef: string; customerRef: string; planRef: string; periodStart: string; periodEnd: string; status: SubscriptionStatus};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("stripe_credit_invoice_invalid");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): Date {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value * 1000).getTime())) throw new Error("stripe_credit_period_invalid");
  return new Date(value * 1000);
}

/** Pinned Stripe wire shape: parent.subscription_details and pricing.price_details.
 * https://docs.stripe.com/changelog/basil/2025-03-31/invoice-pricing-configurations
 * Only authenticated provider reads reach here; invoice metadata never selects a user.
 */
export function paidMonthlyCreditPeriod(invoice: Record<string, unknown>, price: Record<string, unknown>, subject: Subject): PaidCreditPeriod | null {
  const parent = object(invoice.parent), subscription = object(parent.subscription_details);
  if (invoice.object !== "invoice" || typeof invoice.id !== "string" || !/^in_[A-Za-z0-9_]+$/.test(invoice.id) ||
    parent.type !== "subscription_details" || subscription.subscription !== subject.subscriptionRef || invoice.customer !== subject.customerRef ||
    invoice.status !== "paid" || invoice.amount_remaining !== 0) throw new Error("stripe_credit_invoice_mismatch");
  if (!["subscription_create", "subscription_cycle", "subscription_update"].includes(String(invoice.billing_reason))) return null;
  if (subject.status === "trialing") return null;
  if (price.object !== "price" || price.id !== subject.planRef || typeof invoice.currency !== "string" || !/^[a-z]{3}$/.test(invoice.currency) || price.currency !== invoice.currency) throw new Error("stripe_credit_price_mismatch");
  const recurring = object(price.recurring);
  if (price.type !== "recurring" || recurring.interval !== "month" || recurring.interval_count !== 1 || recurring.usage_type !== "licensed") return null;
  const lines = object(invoice.lines);
  if (lines.has_more !== false || !Array.isArray(lines.data)) throw new Error("stripe_credit_invoice_lines_incomplete");
  const candidates: PaidCreditPeriod[] = [];
  for (const raw of lines.data) {
    const line = object(raw);
    if (!line.parent || object(line.parent).type !== "subscription_item_details") continue;
    const detail = object(object(line.parent).subscription_item_details);
    if (detail.proration !== false) continue;
    if (detail.subscription !== undefined && detail.subscription !== subject.subscriptionRef) throw new Error("stripe_credit_invoice_mismatch");
    const pricing = object(line.pricing);
    if (pricing.type !== "price_details" || object(pricing.price_details).price !== subject.planRef) continue;
    if (line.quantity !== 1) throw new Error("stripe_credit_quantity_unsupported");
    const period = object(line.period), start = timestamp(period.start), end = timestamp(period.end);
    const duration = end.getTime() - start.getTime();
    if (duration < 27 * 86_400_000 || duration > 32 * 86_400_000) continue;
    if (end.getTime() > Date.now() && (start.toISOString() !== subject.periodStart || end.toISOString() !== subject.periodEnd)) throw new Error("stripe_credit_period_mismatch");
    candidates.push({subscriptionRef: subject.subscriptionRef, invoiceRef: invoice.id, planRef: subject.planRef, periodStart: start, periodEnd: end});
  }
  if (candidates.length !== 1) throw new Error("stripe_credit_monthly_line_mismatch");
  return candidates[0]!;
}
