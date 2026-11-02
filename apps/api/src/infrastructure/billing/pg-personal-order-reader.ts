import { BillingOrder } from "@repo/contracts/billing-credits";
import type { DatabasePort } from "../../application/ports/database.port";
import { BillingOrderError, type PersonalOrderReader } from "../../application/billing/billing-order-service";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { pricingEpochMode } from "./personal-pricing-epoch";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";

/** Reuses the existing private order operation; local expiry never invents a provider closure. */
export class PgPersonalOrderReader implements PersonalOrderReader {
  constructor(private readonly db: DatabasePort) {}
  async read(principal: Principal, orderNo: string) {
    assertPrincipal(principal);
    try {
      return await this.db.withTenant(principal.orgId, async s => {
        if (await pricingEpochMode(s) === "legacy") return {mode:"legacy"} as const;
        const row = (await s.query<PersonalPurchaseRow>(`SELECT * FROM billing_personal_purchases
          WHERE purchase_ref=$1 AND user_id=$2 AND generation=$3`, [orderNo,principal.userId,BILLING_ACCOUNTING_GENERATION])).rows[0];
        if (!row) return {mode:"active",order:null} as const;
        const p = personalPurchaseView(row);
        const receipt = (await s.query<{paid_at:Date|null}>(`SELECT paid_at FROM billing_personal_payment_receipts
          WHERE purchase_ref=$1 AND NOT manual_review ORDER BY verified_at,payment_ref LIMIT 1`, [p.purchaseRef])).rows[0];
        if (p.fulfilledAt && !receipt) throw new BillingOrderError("payment_provider_not_configured");
        const status = p.paymentReviewRequired ? "FAILED" : p.fulfilledAt ? "SUCCESS" : p.closedAt ? "CLOSED" : "PENDING";
        // Only a payable purchase needs the original address. Terminal financial facts stand independently.
        if(status==="PENDING"&&(!p.url||!p.expiresAt))throw new BillingOrderError("payment_provider_not_configured");
        return {mode:"active",order:BillingOrder.parse({orderNo:p.purchaseRef,ownerType:"user",ownerId:p.userId,provider:p.provider,status,
          packageId:p.product.sku,amountFen:p.product.amountMinor,currency:p.product.currency,
          baseCredits:p.product.kind === "subscription" ? p.product.monthlyCredits : p.product.credits,bonusCredits:0,qrCodeUrl:p.url,
          createdAt:p.createdAt.toISOString(),expiredAt:p.expiresAt?.toISOString()??null,paidAt:status === "SUCCESS" ? receipt?.paid_at?.toISOString() ?? null : null,
          notifyAt:null,closedAt:status === "CLOSED" ? p.closedAt?.toISOString() ?? null : null,lastErrorCode:null})} as const;
      });
    } catch (error) {
      if (error instanceof BillingOrderError) throw error;
      throw new BillingOrderError("payment_provider_not_configured");
    }
  }
}
