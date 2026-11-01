import { WelcomeCreditGrant, WELCOME_CREDITS, WELCOME_CREDIT_VALIDITY_DAYS, WELCOME_CREDIT_PROGRAM } from "@repo/contracts/billing-pricing";
import type { TenantSession } from "../../application/ports/database.port";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { creditDecimal } from "../../application/billing/credit-consumption";
import { CREDIT_PERIOD_GRANT_SQL as SQL } from "./credit-period-sql";
import { normalizeCreditPeriods } from "./pg-credit-periods";
type WelcomeRow={granted_hundredths:string;remaining_hundredths:string;plan_ref:string;period_start:Date;period_end:Date;expired_at:Date|null};
/** Trusted caller supplies the authenticated user; reads never create or repair a grant. */
export async function readWelcomeCreditGrant(s:TenantSession,userId:string,at:Date=new Date()) {
  if(!userId||!Number.isFinite(at.getTime()))throw Error("welcome_credit_clock_invalid");
  const wallet=(await s.query<{wallet_id:string}>(SQL.periodLockUserWallet,[userId])).rows[0];
  if(wallet)await normalizeCreditPeriods(s,wallet.wallet_id,at);
  const row=(await s.query<WelcomeRow>(`SELECT p.* FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
    WHERE w.owner_type='user' AND w.owner_id=$1 AND p.source_kind='welcome'`,[userId])).rows[0];
  if(!row) {
    const epoch=(await s.query<{generation:string|null;activated_at:Date|null;eligible:boolean}>(`SELECT e.generation,e.activated_at,
      COALESCE(e.activated_at<=now() AND c.created_at>=e.activated_at,false) AS eligible
      FROM billing_pricing_epoch e LEFT JOIN credentials c ON c.user_id=$1 WHERE e.singleton=true`,[userId])).rows[0];
    if(!epoch)throw Error("billing_pricing_epoch_missing");
    if(epoch.generation!==null&&epoch.generation!==BILLING_ACCOUNTING_GENERATION)throw Error("billing_pricing_epoch_mismatch");
    if(epoch.eligible)throw Error("welcome_grant_missing");
    return WelcomeCreditGrant.parse({status:"none",grant:null});
  }
  if(row.plan_ref!==WELCOME_CREDIT_PROGRAM||BigInt(row.granted_hundredths)!==BigInt(WELCOME_CREDITS)*100n||
    row.period_end.getTime()-row.period_start.getTime()!==WELCOME_CREDIT_VALIDITY_DAYS*86400000)throw Error("welcome_grant_snapshot_mismatch");
  const expired=row.expired_at!==null||row.period_end<=at;
  return WelcomeCreditGrant.parse({status:expired?"expired":"granted",grant:{credits:WELCOME_CREDITS,
    remainingCredits:expired?0:Number(creditDecimal(BigInt(row.remaining_hundredths))),grantedAt:row.period_start.toISOString(),expiresAt:row.period_end.toISOString()}});
}
