import { PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { SubscriptionStatus } from "@repo/contracts/billing-subscription";
import { assertPrincipal, type Principal } from "../../domain/principal";
import type { DatabasePort } from "../../application/ports/database.port";
import { requireActivePricingEpoch } from "./personal-pricing-epoch";
import { grantDuePersonalTerms } from "./personal-credit-terms";
import { readWelcomeCreditGrant } from "./welcome-credit-periods";

/** Payment expiry, monthly quota, and provider renewal status are independent facts. */
export class PgPersonalEntitlementRepository {
  constructor(private readonly db: DatabasePort) {}
  async read(principal: Principal): Promise<PricingSubscriptionInfo> {
    assertPrincipal(principal);
    return this.db.withTenant(principal.orgId, async session => {
      await requireActivePricingEpoch(session);
      await grantDuePersonalTerms(session, principal.userId);
      const welcomeCreditGrant = await readWelcomeCreditGrant(session, principal.userId);
      const term = (await session.query<{ term_id: string; provider: "stripe" | "wechat"; subscription_ref: string; sku: string; billing_cycle: "month" | "year"; period_start: Date; period_end: Date; active: boolean }>(
        `SELECT *, period_end>now() AS active FROM billing_personal_terms WHERE user_id=$1 AND period_start<=now() ORDER BY period_start DESC,term_id DESC LIMIT 1`, [principal.userId])).rows[0];
      const stripe = (await session.query<{ status: string; cancel_at_period_end: boolean; subscription_ref: string }>(
        `SELECT b.* FROM billing_personal_stripe_bindings b JOIN billing_personal_purchases p USING(purchase_ref)
         WHERE p.user_id=$1 AND ($2::text IS NULL OR b.subscription_ref=$2)
         ORDER BY p.created_at DESC,p.purchase_ref DESC LIMIT 1`, [principal.userId, term?.provider === "stripe" ? term.subscription_ref : null])).rows[0];
      const purchase = (await session.query<{ pending: boolean; review: boolean }>(`SELECT
        COALESCE(bool_or(fulfilled_at IS NULL AND closed_at IS NULL),false) AS pending,
        COALESCE(bool_or(payment_review_required),false) AS review FROM billing_personal_purchases
        WHERE user_id=$1 AND product->>'kind'='subscription'`, [principal.userId])).rows[0]!;
      const period = term ? (await session.query<{ granted_hundredths: string; remaining_hundredths: string; period_start: Date; period_end: Date; expired: boolean }>(
        `SELECT p.*,p.expired_at IS NOT NULL OR p.period_end<=now() AS expired FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
         WHERE w.owner_type='user' AND w.owner_id=$1 AND p.source_kind='subscription' AND p.subscription_ref=$2
         AND p.period_start>=$3 AND p.period_start<=now() AND p.plan_ref=$4 ORDER BY p.period_start DESC LIMIT 1`, [principal.userId, term.subscription_ref, term.period_start, term.sku])).rows[0] : null;
      // A paid Stripe term must have its immutable provider binding; no synthetic renewal state.
      if (term?.provider === "stripe" && !stripe) throw Error("personal_stripe_binding_missing");
      const status = term?.provider === "wechat" ? term.active ? "active" : "canceled" : stripe ? SubscriptionStatus.parse(stripe.status) : "none";
      return PricingSubscriptionInfo.parse({ status, planRef: term?.sku ?? null, plan: term ? "pro" : null,
        currentPeriodEnd: term?.period_end.toISOString() ?? null, billingCycle: term?.billing_cycle ?? null,
        renewalMode: term ? term.provider === "stripe" ? "automatic" : "manual" : null,
        ...(term || stripe ? { paymentProvider: term?.provider ?? "stripe" } : {}),
        cancelAtPeriodEnd: term?.provider === "wechat" ? false : stripe?.cancel_at_period_end ?? false,
        checkoutPending: purchase.pending, paymentReviewRequired: purchase.review, welcomeCreditGrant,
        creditGrant: period ? { status: period.expired ? "expired" : "granted", grant: {
          credits: Number(period.granted_hundredths) / 100, remainingCredits: period.expired ? 0 : Number(period.remaining_hundredths) / 100,
          periodStart: period.period_start.toISOString(), periodEnd: period.period_end.toISOString() } } : { status: "none", grant: null } });
    });
  }
}
