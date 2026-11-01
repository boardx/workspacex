import { BillingProvider, CreditBalance, OrderNo } from "@repo/contracts/billing-credits";
import { PricingCurrency } from "@repo/contracts/billing-pricing";
import { SubscriptionStatus } from "@repo/contracts/billing-subscription";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { VerifiedPersonalReceipt, VerifiedStripePersonalPayment } from "../../application/billing/personal-payment-ports";
import type { StoredPersonalPurchase } from "../../application/billing/personal-checkout-ports";
import type { CreditingResult } from "../../application/billing/billing-notify-ports";
import { creditDecimal, creditHundredths, creditFacts } from "../../application/billing/credit-consumption";
import { creditMonthBoundary, paidCreditMonthCount } from "../../domain/billing/personal-credit-calendar";
import { requireActivePricingEpoch } from "./personal-pricing-epoch";
import { PERSONAL_CHECKOUT_SQL as PURCHASE } from "./personal-checkout-sql";
import { PERSONAL_PAYMENT_SQL as SQL } from "./personal-payment-sql";
import { BILLING_GLOBAL_SQL as GLOBAL, assertBillingGlobalStatement } from "./billing-global-boundary";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";
import { recordPaidPersonalTerm } from "./personal-credit-terms";
import { normalizeCreditPeriods } from "./pg-credit-periods";
import type { PersonalStripeBinding } from "../../domain/billing/personal-stripe-receipt";

type ReceiptRow = { purchase_ref: string; amount_minor: string; currency: string; paid_at: Date | null; manual_review: boolean };
type StripeBindingRow = { subscription_ref: string; purchase_ref: string; session_ref: string; customer_ref: string; price_ref: string; purchase_anchor: Date };
type PaymentIdentity = Pick<VerifiedPersonalReceipt, "provider" | "purchaseRef" | "paymentRef"> & { subscriptionRef?: string };
type ResolvedPayment = { receipt: VerifiedPersonalReceipt; stripe?: VerifiedStripePersonalPayment };
const creditLimit = BigInt(CreditBalance.maxValue!) * 100n;
/** Provider-only boundary. Browser order creation cannot invoke financial settlement. */
export class PgPersonalPaymentRepository {
  constructor(private readonly db: DatabasePort, private readonly clock: () => Date = () => new Date()) {}
  async settle(input: VerifiedPersonalReceipt): Promise<CreditingResult> {
    return this.apply(input, async () => ({ receipt: input }));
  }
  async settleStripe(purchaseRef: string, subscriptionRef: string, paymentRef: string,
    verify: (purchase: StoredPersonalPurchase) => Promise<VerifiedStripePersonalPayment>): Promise<CreditingResult> {
    if (!/^sub_[A-Za-z0-9_]{1,251}$/.test(subscriptionRef) || !/^in_[A-Za-z0-9_]{1,252}$/.test(paymentRef)) throw Error("personal_receipt_mismatch");
    return this.apply({ purchaseRef, subscriptionRef, paymentRef, provider: "stripe" }, async purchase => {
      const stripe = await verify(purchase);
      return { stripe, receipt: { provider: "stripe", purchaseRef, paymentRef, amountMinor: stripe.term.amountMinor, currency: stripe.term.currency, paidAt: stripe.paidAt } };
    });
  }
  /** A status snapshot alone never creates a paid term or grants credits. */
  async syncStripe(purchaseRef: string, subscriptionRef: string,
    verify: (purchase: StoredPersonalPurchase) => Promise<PersonalStripeBinding>): Promise<void> {
    OrderNo.parse(purchaseRef);
    if (!/^sub_[A-Za-z0-9_]{1,251}$/.test(subscriptionRef)) throw Error("personal_receipt_mismatch");
    await this.db.withoutTenant(async raw => {
      await raw.query("SET LOCAL statement_timeout='12000ms'"); await raw.query("SET LOCAL lock_timeout='2000ms'");
      const session: TenantSession = { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
      await requireActivePricingEpoch(session);
      await session.query(PURCHASE.personalPurchaseUserLock, [`personal-subscription:stripe:${subscriptionRef}`]);
      const row = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRef, [purchaseRef])).rows[0];
      if (!row) throw Error("personal_purchase_unknown");
      await session.query(PURCHASE.personalPurchaseUserLock, [`billing-subscription:${row.user_id}`]);
      const locked = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRefLock, [purchaseRef])).rows[0]!;
      const purchase = personalPurchaseView(locked), binding = await verify(purchase);
      await this.persistStripeBinding(session, purchase, subscriptionRef, binding, new Date(this.clock().getTime() + 300000));
    });
  }
  private async apply(identity: PaymentIdentity, resolve: (purchase: StoredPersonalPurchase) => Promise<ResolvedPayment>): Promise<CreditingResult> {
    BillingProvider.parse(identity.provider); OrderNo.parse(identity.purchaseRef);
    if (typeof identity.paymentRef !== "string" || identity.paymentRef.length > 255 || !/^(?:wx|pi|in)_[A-Za-z0-9_]+$/.test(identity.paymentRef)) throw Error("personal_receipt_mismatch");
    return this.db.withoutTenant(async raw => {
      await raw.query("SET LOCAL statement_timeout='12000ms'"); await raw.query("SET LOCAL lock_timeout='2000ms'");
      const session: TenantSession = { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
      await requireActivePricingEpoch(session);
      await session.query(SQL.personalReceiptLock, [`personal-receipt:${identity.provider}:${identity.paymentRef}`]);
      const initial = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRef, [identity.purchaseRef])).rows[0];
      if (!initial) throw Error("personal_purchase_unknown");
      const known = personalPurchaseView(initial);
      if (known.product.kind === "subscription") {
        if (identity.provider === "stripe" && !identity.subscriptionRef) throw Error("personal_stripe_binding_required");
        await session.query(PURCHASE.personalPurchaseUserLock, [`personal-subscription:${identity.provider}:${identity.subscriptionRef ?? known.purchaseRef}`]);
      }
      await session.query(PURCHASE.personalPurchaseUserLock, [`billing-subscription:${known.userId}`]);
      const row = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRefLock, [identity.purchaseRef])).rows[0]!;
      const purchase = personalPurchaseView(row), product = purchase.product;
      const resolved = await resolve(purchase), input = resolved.receipt, at = this.clock();
      if (input.purchaseRef !== identity.purchaseRef || input.provider !== identity.provider || input.paymentRef !== identity.paymentRef) throw Error("personal_receipt_mismatch");
      if (purchase.provider !== input.provider || product.currency !== input.currency || product.amountMinor !== input.amountMinor ||
        (input.provider === "wechat" && !input.paymentRef.startsWith("wx_")) ||
        (input.provider === "stripe" && product.kind === "credit_topup" && !input.paymentRef.startsWith("pi_")) ||
        !PricingCurrency.safeParse(input.currency).success || !Number.isFinite(at.getTime()) ||
        (input.paidAt !== null && (!Number.isFinite(input.paidAt.getTime()) || input.paidAt > at || input.paidAt.getTime() < Math.floor(purchase.createdAt.getTime() / 1000) * 1000)) ||
        (input.provider === "wechat" && (input.paidAt === null || input.currency !== "CNY"))) throw Error("personal_receipt_mismatch");
      if (input.provider === "stripe" && product.kind === "subscription") {
        if (!resolved.stripe) throw Error("personal_stripe_binding_required");
        await this.stripeBinding(session, purchase, identity, resolved.stripe);
      } else if (resolved.stripe) throw Error("personal_receipt_mismatch");
      const existing = (await session.query<ReceiptRow>(SQL.personalReceiptFind, [input.provider, input.paymentRef])).rows[0];
      if (existing) {
        if (existing.purchase_ref !== purchase.purchaseRef || Number(existing.amount_minor) !== input.amountMinor || existing.currency !== input.currency ||
          (existing.paid_at?.getTime() ?? null) !== (input.paidAt?.getTime() ?? null)) throw Error("personal_receipt_replay_mismatch");
        return { completed: true, manual: existing.manual_review };
      }
      if (purchase.fulfilledAt !== null && !resolved.stripe) throw Error("personal_purchase_already_paid");
      await session.query(SQL.personalReceiptInsert, [input.provider, input.paymentRef, purchase.purchaseRef, input.amountMinor, input.currency, input.paidAt]);
      await session.query(SQL.personalGrantSavepoint);
      try {
        if (product.kind === "subscription") {
          if (resolved.stripe) await recordPaidPersonalTerm(session, resolved.stripe.term, at);
          else {
            const anchor = input.paidAt!;
            await recordPaidPersonalTerm(session, { userId: purchase.userId, provider: input.provider, paymentRef: input.paymentRef, subscriptionRef: purchase.purchaseRef,
            sku: product.sku, currency: product.currency, amountMinor: product.amountMinor, purchaseAnchor: anchor, monthOffset: 0,
            periodStart: anchor, periodEnd: creditMonthBoundary(anchor, paidCreditMonthCount(product.cycle)) }, at);
          }
        } else {
          await session.query(GLOBAL.ensureWallet, ["user", purchase.userId]);
          const locked = (await session.query<{ wallet_id: string }>(GLOBAL.lockWallet, ["user", purchase.userId])).rows[0]!;
          await normalizeCreditPeriods(session, locked.wallet_id, at);
          const wallet = (await session.query<{ wallet_id: string; balance: string; total_purchased: number }>(GLOBAL.lockWallet, ["user", purchase.userId])).rows[0]!;
          const grant = BigInt(product.credits) * 100n, balance = creditHundredths(wallet.balance) + grant;
          if (balance > creditLimit || BigInt(wallet.total_purchased) * 100n + grant > creditLimit) throw Error("credit_balance_unrepresentable");
          await session.query(SQL.personalPackLedger, [wallet.wallet_id, product.credits, creditDecimal(balance), purchase.purchaseRef]);
          await session.query(SQL.personalPackWallet, [wallet.wallet_id, creditDecimal(balance), product.credits]);
        }
      } catch (error) {
        if (!(error instanceof Error) || !["credit_balance_unrepresentable", "personal_term_overlap"].includes(error.message)) throw error;
        await session.query(SQL.personalGrantRollback);
        await session.query(SQL.personalReceiptManual, [input.provider, input.paymentRef, error.message]);
        await session.query(SQL.personalPurchaseReview, [purchase.purchaseRef]);
        await session.query(SQL.personalGrantRelease);
        return { completed: true, manual: true };
      }
      await session.query(SQL.personalGrantRelease);
      await session.query(SQL.personalPurchaseFulfilled, [purchase.purchaseRef]);
      return { completed: true, manual: false };
    });
  }
  private async stripeBinding(session: TenantSession, purchase: StoredPersonalPurchase, identity: PaymentIdentity, proof: VerifiedStripePersonalPayment) {
    const { binding, term } = proof;
    if (term.provider !== "stripe" || term.userId !== purchase.userId || term.paymentRef !== identity.paymentRef || term.subscriptionRef !== identity.subscriptionRef ||
      term.sku !== purchase.product.sku || term.currency !== purchase.product.currency || term.amountMinor !== purchase.product.amountMinor ||
      term.purchaseAnchor.getTime() !== binding.purchaseAnchor.getTime()) throw Error("personal_stripe_binding_mismatch");
    await this.persistStripeBinding(session, purchase, identity.subscriptionRef!, binding, term.periodEnd);
  }
  private async persistStripeBinding(session: TenantSession, purchase: StoredPersonalPurchase, subscriptionRef: string, binding: PersonalStripeBinding, nextCheck: Date) {
    const status = SubscriptionStatus.safeParse(binding.status);
    if (binding.provider !== "stripe" || binding.purchaseRef !== purchase.purchaseRef || binding.userId !== purchase.userId ||
      binding.generation !== purchase.generation || binding.catalogVersion !== purchase.catalogVersion || creditFacts(binding.product) !== creditFacts(purchase.product) ||
      binding.subscriptionRef !== subscriptionRef || (purchase.sessionRef !== null && binding.sessionRef !== purchase.sessionRef) ||
      !/^cs_[A-Za-z0-9_]{1,252}$/.test(binding.sessionRef) || !/^cus_[A-Za-z0-9_]{1,251}$/.test(binding.customerRef) || !/^price_[A-Za-z0-9_]{1,249}$/.test(binding.priceRef) ||
      !status.success || status.data === "none" || typeof binding.cancelAtPeriodEnd !== "boolean") throw Error("personal_stripe_binding_mismatch");
    await session.query(SQL.personalReceiptLock, [`personal-stripe-customer:${binding.customerRef}`]);
    if ((await session.query(SQL.personalStripeCustomerOwner, [binding.customerRef, purchase.userId])).rows.length) throw Error("personal_stripe_customer_owner_mismatch");
    const rows = (await session.query<StripeBindingRow>(SQL.personalStripeBinding, [binding.subscriptionRef, purchase.purchaseRef])).rows;
    if (rows.some(row => row.subscription_ref !== binding.subscriptionRef || row.purchase_ref !== purchase.purchaseRef || row.session_ref !== binding.sessionRef ||
      row.customer_ref !== binding.customerRef || row.price_ref !== binding.priceRef || row.purchase_anchor.getTime() !== binding.purchaseAnchor.getTime())) throw Error("personal_stripe_binding_mismatch");
    const next = ["canceled", "incomplete_expired"].includes(binding.status) ? null : nextCheck;
    if (!rows.length) await session.query(SQL.personalStripeBind, [binding.subscriptionRef, purchase.purchaseRef, binding.sessionRef, binding.customerRef,
      binding.priceRef, binding.purchaseAnchor, binding.status, binding.cancelAtPeriodEnd, next]);
    else await session.query(SQL.personalStripeSnapshot, [binding.subscriptionRef, binding.status, binding.cancelAtPeriodEnd, next]);
  }
}
