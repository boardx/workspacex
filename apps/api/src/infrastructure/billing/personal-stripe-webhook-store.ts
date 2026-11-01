import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { STRIPE_INVOICE_PAGE_SIZE, type StripeEvent, type StripeSnapshotProvider, type StripeWebhookStore } from "../../application/billing/billing-stripe-webhook-service";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { PERSONAL_PAYMENT_PRODUCT } from "../../domain/billing/personal-payment-product";
import { bindPersonalStripeSubscription, verifiedPersonalStripeTerm } from "../../domain/billing/personal-stripe-receipt";
import { pricingEpochMode, requireActivePricingEpoch } from "./personal-pricing-epoch";
import { assertBillingGlobalStatement } from "./billing-global-boundary";
import { PERSONAL_PAYMENT_SQL as SQL } from "./personal-payment-sql";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";
import type { PgPersonalPaymentRepository } from "./pg-personal-payment-repository";

type CheckoutReader = { retrieve(id: string): Promise<Record<string, unknown>>; liveMode(): boolean };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("personal_stripe_object_invalid");
  return value as Record<string, unknown>;
}
function reference(value: unknown, prefix: string): string {
  if (typeof value !== "string" || value.length > 255 || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) throw Error("personal_stripe_reference_invalid");
  return value;
}
/** Events are wakeups. Only authenticated provider reads and a persisted server quote establish rights. */
export class PersonalStripeWebhookStore implements StripeWebhookStore {
  constructor(private readonly db: DatabasePort, private readonly checkout: CheckoutReader,
    private readonly payments: PgPersonalPaymentRepository, private readonly legacy: StripeWebhookStore) {}
  private environment(value: Record<string, unknown>) {
    if (value.livemode !== this.checkout.liveMode()) throw Error("personal_stripe_environment_mismatch");
    return value;
  }
  private async select(ref?: string) {
    return this.db.withoutTenant(async raw => {
      const session: TenantSession = { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
      const mode = await pricingEpochMode(session);
      const row = mode === "active" && ref ? (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRef, [ref])).rows[0] : null;
      return { mode, purchase: row ? personalPurchaseView(row) : null };
    });
  }
  async apply(event: StripeEvent, provider: StripeSnapshotProvider): Promise<boolean> {
    if ((await this.select()).mode === "legacy") return this.legacy.apply(event, provider);
    return this.synchronize(event.type, event.object.id, provider);
  }
  /** Authoritative background reconciliation is distinct from a signature-verified webhook event. */
  async reconcileCheckout(id: string, provider: StripeSnapshotProvider): Promise<boolean> {
    if ((await this.select()).mode !== "active") throw Error("personal_recovery_inactive");
    return this.synchronize("checkout.session.completed", id, provider);
  }
  async reconcileSubscription(id: string, provider: StripeSnapshotProvider): Promise<boolean> {
    if ((await this.select()).mode !== "active") throw Error("personal_recovery_inactive");
    return this.synchronize("customer.subscription.updated", id, provider);
  }
  /** A bounded page commits individual verified invoices. A failed/interrupted page keeps its original cursor. */
  async reconcilePaidInvoices(subscriptionRef: string, cursor: string | undefined, provider: StripeSnapshotProvider,
    shouldContinue: () => boolean = () => true): Promise<{ nextCursor: string | null; interrupted: boolean }> {
    reference(subscriptionRef, "sub"); if (cursor !== undefined) reference(cursor, "in");
    if (!shouldContinue()) return { nextCursor: cursor ?? null, interrupted: true };
    const read = <T>(query: (session: TenantSession) => Promise<T>) => this.db.withoutTenant(async raw => {
      const session: TenantSession = { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
      await requireActivePricingEpoch(session); return query(session);
    });
    const owner = await read(async session => (await session.query<{ purchase_ref: string }>(SQL.personalStripePurchase, [subscriptionRef, BILLING_ACCOUNTING_GENERATION])).rows[0]);
    if (!owner) throw Error("personal_stripe_binding_missing");
    if (!provider.paidInvoices) throw Error("personal_stripe_provider_incomplete");
    const page = await provider.paidInvoices(subscriptionRef, cursor);
    if (!Array.isArray(page.data) || page.data.length > STRIPE_INVOICE_PAGE_SIZE || typeof page.hasMore !== "boolean" ||
      page.hasMore && page.data.length === 0) throw Error("personal_recovery_invoice_page_invalid");
    const ids = page.data.map(invoice => reference(invoice.id, "in"));
    if (new Set(ids).size !== ids.length || cursor !== undefined && ids.includes(cursor)) throw Error("personal_recovery_invoice_page_invalid");
    for (const id of ids) {
      if (!shouldContinue()) return { nextCursor: cursor ?? null, interrupted: true };
      if (!await this.synchronize("invoice.paid", id, provider)) throw Error("personal_recovery_retry_required");
      // An ignored foreign/retired event is not a recovered invoice for this immutable binding.
      const receipt = await read(async session => (await session.query<{ purchase_ref: string }>(SQL.personalReceiptFind, ["stripe", id])).rows[0]);
      if (receipt?.purchase_ref !== owner.purchase_ref) throw Error("personal_recovery_receipt_missing");
    }
    return { nextCursor: page.hasMore ? ids.at(-1)! : null, interrupted: false };
  }
  private async synchronize(type: string, id: unknown, provider: StripeSnapshotProvider): Promise<boolean> {
    const isCheckout = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(type);
    const isSubscription = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type);
    const isInvoice = ["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"].includes(type);
    if (!isCheckout && !isSubscription && !isInvoice) return true;
    if (!provider.invoice || !provider.price) throw Error("personal_stripe_provider_incomplete");
    let session: Record<string, unknown> | undefined, invoice: Record<string, unknown> | undefined, subscription: Record<string, unknown>;
    if (isCheckout) {
      session = this.environment(await this.checkout.retrieve(reference(id, "cs")));
      const metadata = object(session.metadata);
      if (metadata.product !== PERSONAL_PAYMENT_PRODUCT || metadata.generation !== BILLING_ACCOUNTING_GENERATION) return true;
      const selected = await this.select(String(metadata.purchase_ref));
      if (!selected.purchase) return true;
      if (selected.purchase.product.kind === "credit_topup") return this.pack(selected.purchase.purchaseRef, session);
      subscription = this.environment(await provider.subscription(reference(session.subscription, "sub")));
    } else if (isInvoice) {
      invoice = this.environment(await provider.invoice(reference(id, "in")));
      const parent = object(invoice.parent);
      if (parent.type !== "subscription_details") return true;
      subscription = this.environment(await provider.subscription(reference(object(parent.subscription_details).subscription, "sub")));
    } else subscription = this.environment(await provider.subscription(reference(id, "sub")));
    const metadata = object(subscription.metadata);
    if (metadata.product !== PERSONAL_PAYMENT_PRODUCT || metadata.generation !== BILLING_ACCOUNTING_GENERATION) return true;
    const { purchase } = await this.select(String(metadata.purchase_ref));
    if (!purchase) return true;
    if (purchase.provider !== "stripe" || purchase.product.kind !== "subscription") throw Error("personal_stripe_purchase_mismatch");
    if (!session) {
      if (!purchase.sessionRef) return false; // The original idempotent Checkout creation must finish binding first.
      session = this.environment(await this.checkout.retrieve(purchase.sessionRef));
    }
    const checkout = session, subRef = reference(subscription.id, "sub");
    const items = object(subscription.items), data = items.data;
    if (!Array.isArray(data) || data.length !== 1) throw Error("personal_stripe_subscription_invalid");
    const price = this.environment(await provider.price(reference(object(object(data[0]).price).id, "price")));
    if (!invoice && subscription.latest_invoice != null) invoice = this.environment(await provider.invoice(reference(subscription.latest_invoice, "in")));
    // Cancellation and past_due may change while earlier events are in flight. Read again inside the binding lock.
    const verify = async (locked: typeof purchase) => bindPersonalStripeSubscription({ ...locked, sessionRef: reference(checkout.id, "cs") }, checkout,
      this.environment(await provider.subscription(subRef)), price);
    if (invoice?.status === "paid") {
      const paidInvoice = invoice, transition = object(invoice.status_transitions), seconds = transition.paid_at;
      if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 253402300799) throw Error("personal_stripe_payment_time_invalid");
      await this.payments.settleStripe(purchase.purchaseRef, subRef, reference(invoice.id, "in"), async locked => {
        const binding = await verify(locked);
        return { binding, term: verifiedPersonalStripeTerm(binding, paidInvoice, price), paidAt: new Date(seconds * 1000) };
      });
    } else {
      if (isInvoice && ["invoice.paid", "invoice.payment_succeeded"].includes(type)) return false;
      await this.payments.syncStripe(purchase.purchaseRef, subRef, verify);
    }
    return true;
  }
  private async pack(purchaseRef: string, session: Record<string, unknown>) {
    const { purchase } = await this.select(purchaseRef);
    if (!purchase || purchase.provider !== "stripe" || purchase.product.kind !== "credit_topup") throw Error("personal_stripe_purchase_mismatch");
    const metadata = object(session.metadata);
    if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" ||
      session.client_reference_id !== purchaseRef || metadata.sku !== purchase.product.sku ||
      (purchase.sessionRef !== null && purchase.sessionRef !== session.id) ||
      session.amount_total !== purchase.product.amountMinor || session.currency !== purchase.product.currency.toLowerCase()) throw Error("personal_stripe_checkout_mismatch");
    await this.payments.settle({ purchaseRef, provider: "stripe", paymentRef: reference(session.payment_intent, "pi"),
      amountMinor: purchase.product.amountMinor, currency: purchase.product.currency, paidAt: null });
    return true;
  }
}
