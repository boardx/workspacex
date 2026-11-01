import { BillingProvider, CreditBalance, OrderNo } from "@repo/contracts/billing-credits";
import { PricingCurrency } from "@repo/contracts/billing-pricing";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { VerifiedPersonalReceipt } from "../../application/billing/personal-payment-ports";
import type { CreditingResult } from "../../application/billing/billing-notify-ports";
import { creditDecimal, creditHundredths } from "../../application/billing/credit-consumption";
import { creditMonthBoundary, paidCreditMonthCount } from "../../domain/billing/personal-credit-calendar";
import { requireActivePricingEpoch } from "./personal-pricing-epoch";
import { PERSONAL_CHECKOUT_SQL as PURCHASE } from "./personal-checkout-sql";
import { PERSONAL_PAYMENT_SQL as SQL } from "./personal-payment-sql";
import { BILLING_GLOBAL_SQL as GLOBAL, assertBillingGlobalStatement } from "./billing-global-boundary";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";
import { recordPaidPersonalTerm } from "./personal-credit-terms";
import { normalizeCreditPeriods } from "./pg-credit-periods";

type ReceiptRow = { purchase_ref: string; amount_minor: string; currency: string; paid_at: Date | null; manual_review: boolean };
const creditLimit = BigInt(CreditBalance.maxValue!) * 100n;
/** Provider-only boundary. Browser order creation cannot invoke financial settlement. */
export class PgPersonalPaymentRepository {
  constructor(private readonly db: DatabasePort, private readonly clock: () => Date = () => new Date()) {}
  async settle(input: VerifiedPersonalReceipt): Promise<CreditingResult> {
    BillingProvider.parse(input.provider); OrderNo.parse(input.purchaseRef);
    if (typeof input.paymentRef !== "string" || input.paymentRef.length > 255 || !/^(?:wx|pi|in)_[A-Za-z0-9_]+$/.test(input.paymentRef)) throw Error("personal_receipt_mismatch");
    return this.db.withoutTenant(async raw => {
      await raw.query("SET LOCAL statement_timeout='12000ms'"); await raw.query("SET LOCAL lock_timeout='2000ms'");
      const session: TenantSession = { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
      await requireActivePricingEpoch(session);
      await session.query(SQL.personalReceiptLock, [`personal-receipt:${input.provider}:${input.paymentRef}`]);
      const initial = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRef, [input.purchaseRef])).rows[0];
      if (!initial) throw Error("personal_purchase_unknown");
      const known = personalPurchaseView(initial);
      if (known.product.kind === "subscription") await session.query(PURCHASE.personalPurchaseUserLock, [`personal-subscription:${input.provider}:${known.purchaseRef}`]);
      await session.query(PURCHASE.personalPurchaseUserLock, [`billing-subscription:${known.userId}`]);
      const row = (await session.query<PersonalPurchaseRow>(SQL.personalPurchaseRefLock, [input.purchaseRef])).rows[0]!;
      const purchase = personalPurchaseView(row), product = purchase.product, at = this.clock();
      if (purchase.provider !== input.provider || product.currency !== input.currency || product.amountMinor !== input.amountMinor ||
        (input.provider === "wechat" && !input.paymentRef.startsWith("wx_")) ||
        (input.provider === "stripe" && product.kind === "credit_topup" && !input.paymentRef.startsWith("pi_")) ||
        !PricingCurrency.safeParse(input.currency).success || !Number.isFinite(at.getTime()) ||
        (input.paidAt !== null && (!Number.isFinite(input.paidAt.getTime()) || input.paidAt > at || input.paidAt.getTime() < Math.floor(purchase.createdAt.getTime() / 1000) * 1000)) ||
        (input.provider === "wechat" && (input.paidAt === null || input.currency !== "CNY"))) throw Error("personal_receipt_mismatch");
      if (input.provider === "stripe" && product.kind === "subscription") throw Error("personal_stripe_binding_required");
      const existing = (await session.query<ReceiptRow>(SQL.personalReceiptFind, [input.provider, input.paymentRef])).rows[0];
      if (existing) {
        if (existing.purchase_ref !== purchase.purchaseRef || Number(existing.amount_minor) !== input.amountMinor || existing.currency !== input.currency ||
          (existing.paid_at?.getTime() ?? null) !== (input.paidAt?.getTime() ?? null)) throw Error("personal_receipt_replay_mismatch");
        return { completed: true, manual: existing.manual_review };
      }
      if (purchase.fulfilledAt !== null) throw Error("personal_purchase_already_paid");
      await session.query(SQL.personalReceiptInsert, [input.provider, input.paymentRef, purchase.purchaseRef, input.amountMinor, input.currency, input.paidAt]);
      await session.query(SQL.personalGrantSavepoint);
      try {
        if (product.kind === "subscription") {
          const anchor = input.paidAt!;
          await recordPaidPersonalTerm(session, { userId: purchase.userId, provider: input.provider, paymentRef: input.paymentRef, subscriptionRef: purchase.purchaseRef,
            sku: product.sku, currency: product.currency, amountMinor: product.amountMinor, purchaseAnchor: anchor, monthOffset: 0,
            periodStart: anchor, periodEnd: creditMonthBoundary(anchor, paidCreditMonthCount(product.cycle)) }, at);
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
}
