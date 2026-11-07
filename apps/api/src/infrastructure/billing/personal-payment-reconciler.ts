import type { StoredPersonalPurchase } from "../../application/billing/personal-checkout-ports";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { PERSONAL_PAYMENT_PRODUCT } from "../../domain/billing/personal-payment-product";
import type { PersonalStripeCheckoutClient } from "./personal-stripe-checkout-client";
import type { PersonalWechatPaymentClient } from "./personal-wechat-payment-client";
import type { PgPersonalPaymentRepository } from "./pg-personal-payment-repository";
import type { PgPersonalCheckoutRepository } from "./pg-personal-checkout-repository";

/** An internal poller can recover verified payments; neither elapsed time nor a browser return proves closure. */
export class PersonalPaymentReconciler {
  constructor(private readonly stripe: Pick<PersonalStripeCheckoutClient, "retrieve" | "liveMode">,
    private readonly wechat: Pick<PersonalWechatPaymentClient, "reconcile">,
    private readonly payments: Pick<PgPersonalPaymentRepository, "settle">,
    private readonly purchases: Pick<PgPersonalCheckoutRepository, "confirmClosed">,
    private readonly synchronize: { reconcileCheckout(id: string): Promise<boolean> }) {}
  async reconcile(purchase: StoredPersonalPurchase): Promise<"pending" | "closed" | "paid" | "unbound" | "ignored"> {
    if (purchase.generation !== BILLING_ACCOUNTING_GENERATION) throw Error("personal_recovery_generation_mismatch");
    if (purchase.fulfilledAt || purchase.closedAt || purchase.paymentReviewRequired) return "ignored";
    if (!purchase.sessionRef) return "unbound"; // Never manufacture a new merchant identity for an unresolved request.
    if (purchase.provider === "wechat") {
      if (purchase.sessionRef !== purchase.purchaseRef) throw Error("personal_recovery_binding_mismatch");
      const state = await this.wechat.reconcile(purchase);
      if (state.state === "closed") return await this.purchases.confirmClosed(purchase) ? "closed" : "pending";
      if (state.state === "paid") {
        await this.payments.settle({ provider: "wechat", purchaseRef: purchase.purchaseRef, paymentRef: state.paymentRef,
          paidAt: state.paidAt, amountMinor: purchase.product.amountMinor, currency: purchase.product.currency });
        return "paid";
      }
      return "pending";
    }
    const session = await this.stripe.retrieve(purchase.sessionRef), metadata = session.metadata as Record<string, unknown> | null;
    if (session.object !== "checkout.session" || session.id !== purchase.sessionRef || session.livemode !== this.stripe.liveMode() ||
      session.mode !== (purchase.product.kind === "subscription" ? "subscription" : "payment") ||
      session.client_reference_id !== purchase.purchaseRef || session.amount_total !== purchase.product.amountMinor ||
      session.currency !== purchase.product.currency.toLowerCase() || metadata?.product !== PERSONAL_PAYMENT_PRODUCT ||
      metadata.purchase_ref !== purchase.purchaseRef || metadata.generation !== purchase.generation || metadata.sku !== purchase.product.sku) throw Error("personal_recovery_snapshot_mismatch");
    if (session.status === "expired" && session.payment_status === "unpaid") return await this.purchases.confirmClosed(purchase) ? "closed" : "pending";
    if (session.status === "complete" && session.payment_status === "paid") {
      if (!await this.synchronize.reconcileCheckout(purchase.sessionRef)) throw Error("personal_recovery_retry_required");
      return "paid";
    }
    if (["open", "complete"].includes(String(session.status)) && ["unpaid", "paid", "no_payment_required"].includes(String(session.payment_status))) return "pending";
    throw Error("personal_recovery_state_invalid");
  }
}
