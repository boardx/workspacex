import { SubscriptionHistory, SubscriptionHistoryQuery, SubscriptionStatus, subscriptionEligibility } from "@repo/contracts/billing-subscription";
import { SubscriptionError, type PersonalSubscriptionAccess } from "../../application/billing/billing-subscription-service";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { pricingEpochMode } from "./personal-pricing-epoch";

/** Every read binds the authenticated payer; paid terms, never monthly grants, represent payment history. */
export class PgPersonalSubscriptionAccess implements PersonalSubscriptionAccess {
  constructor(private readonly db: DatabasePort) {}
  private async read<T>(principal: Principal, run: (s: TenantSession, mode: "legacy" | "active") => Promise<T>): Promise<T> {
    assertPrincipal(principal);
    try { return await this.db.withTenant(principal.orgId, async s => run(s, await pricingEpochMode(s))); }
    catch (error) { if (error instanceof SubscriptionError) throw error; throw new SubscriptionError("dependency_unavailable"); }
  }
  assertLegacy(principal: Principal): Promise<void> {
    return this.read(principal, async (_s, mode) => { if (mode !== "legacy") throw new SubscriptionError("dependency_unavailable"); });
  }
  history(principal: Principal, input: {limit:number;offset:number}) {
    const {limit,offset} = SubscriptionHistoryQuery.parse(input);
    return this.read(principal, async (s, mode) => {
      if (mode === "legacy") return null;
      const rows = (await s.query<{term_id:string;period_start:Date;period_end:Date;amount_minor:string;currency:string}>(
        `SELECT term_id,period_start,period_end,amount_minor::text,currency FROM billing_personal_terms
         WHERE user_id=$1 ORDER BY period_start DESC,period_end DESC,term_id DESC LIMIT $2 OFFSET $3`, [principal.userId,limit+1,offset])).rows;
      return SubscriptionHistory.parse({items: rows.slice(0,limit).map(r => ({id:r.term_id,item:"Pro 订阅",periodStart:r.period_start.toISOString(),
        periodEnd:r.period_end.toISOString(),amountMinor:Number(r.amount_minor),currency:r.currency})),hasMore:rows.length>limit});
    });
  }
  management(principal: Principal) {
    return this.read(principal, async (s, mode) => {
      if (mode === "legacy") return {mode} as const;
      const row = (await s.query<{customer_ref:string;status:string}>(`SELECT b.customer_ref,b.status FROM billing_personal_stripe_bindings b
        JOIN billing_personal_purchases p USING(purchase_ref) WHERE p.user_id=$1 AND p.generation=$2
        ORDER BY p.created_at DESC,p.purchase_ref DESC LIMIT 1`, [principal.userId,BILLING_ACCOUNTING_GENERATION])).rows[0];
      const manageable = row && subscriptionEligibility(SubscriptionStatus.parse(row.status)).canManageSubscription;
      if (manageable && !/^cus_[A-Za-z0-9]+$/.test(row.customer_ref)) throw new SubscriptionError("dependency_unavailable");
      return {mode,customerRef:manageable ? row.customer_ref : null} as const;
    });
  }
}
