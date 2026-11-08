import {lockTeamFinancialOwner} from "./team-financial-owner";
import {BILLING_ACCOUNTING_GENERATION} from "../../domain/billing/billing-generation";
import {isLocalOrg} from "../../domain/identity/local-org";
import {DEFAULT_MEMBER_MONTHLY_CREDITS} from '@repo/contracts/member-credit-quota';
import type {TenantSession} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import {CreditConsumptionError,creditHundredths} from '../../application/billing/credit-consumption';

export async function enterpriseCreditPlan(s:TenantSession,orgId:OrgId):Promise<boolean>{
 const row=(await s.query<{plan:string|null;kind:string;billing_generation:string|null}>('SELECT p.plan,p.billing_generation,o.kind FROM organizations o LEFT JOIN organization_plans p ON p.org_id=o.id WHERE o.id=$1',[orgId])).rows[0];
 return row?.plan==='enterprise'&&row.billing_generation===BILLING_ACCOUNTING_GENERATION&&!isLocalOrg(row.kind);
}
/** Actual debit time determines the month. Outstanding holds survive the boundary and already-debited
 * streaming amounts are subtracted from the hold so they are never counted twice. */
export async function readMemberCreditUsage(s:TenantSession,orgId:OrgId,userId:string){
 const row=(await s.query<{used_hundredths:string;held_hundredths:string;unbounded:string}>(`
 SELECT
  (SELECT COALESCE(SUM(t.credits*100),0)::bigint::text FROM credit_transactions t
   JOIN credit_wallets w ON w.wallet_id=t.wallet_id
   WHERE w.owner_type='team' AND w.owner_id=$1 AND t.operator_id=$2 AND t.type='consume'
    AND t.created_at >= (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS used_hundredths,
  COALESCE(SUM(GREATEST(r.reserved_hundredths-COALESCE(r.debited_hundredths,0),0)),0)::text AS held_hundredths,
  COUNT(*) FILTER(WHERE r.reserved_hundredths=0)::text AS unbounded
 FROM credit_consumption_requests r JOIN credit_wallets w ON w.wallet_id=r.wallet_id
 WHERE r.org_id=$1 AND r.user_id=$2 AND w.owner_type='team' AND w.owner_id=$1 AND r.state <> 'settled'`,[orgId,userId])).rows[0];
 return {used:BigInt(row?.used_hundredths??'0'),held:BigInt(row?.held_hundredths??'0'),unbounded:BigInt(row?.unbounded??'0')};
}
/** Caller holds the canonical organization financial lock, shared by admission, settlement and edits. */
export async function assertMemberCreditQuota(s:TenantSession,orgId:OrgId,userId:string,reserved:bigint,bounded:boolean){
 if(!await enterpriseCreditPlan(s,orgId))return reserved;
 const row=(await s.query<{monthly_limit:string}>('SELECT monthly_limit::text FROM member_credit_quota WHERE org_id=$1 AND user_id=$2',[orgId,userId])).rows[0];
 const cap=creditHundredths(row?.monthly_limit??String(DEFAULT_MEMBER_MONTHLY_CREDITS));
 const {used,held,unbounded}=await readMemberCreditUsage(s,orgId,userId);
 const remaining=cap-used-held;
 // Unknown-cost calls exclusively hold the remaining allowance. This is spending-policy
 // capacity, never a fabricated provider usage quantity or a native tariff.
 if(unbounded>0n||remaining<0n||(!bounded&&remaining===0n)||(bounded&&reserved>remaining))throw memberCreditLimitError(orgId);
 return bounded?reserved:remaining;
}

export const memberCreditLimitError=(orgId:OrgId)=>new CreditConsumptionError('credit_required','team',orgId,'member_monthly_credit_quota_exceeded','member_monthly_limit');
/** Check only after a receipt commits. Never roll back incurred provider charges. */
export async function assertMemberCreditContinuation(s:TenantSession,orgId:OrgId,userId:string,requestId:string){
 const denied=()=>new CreditConsumptionError('credit_accounting_unavailable','team',orgId,'credit_receipt_provenance_mismatch');
 if(!await lockTeamFinancialOwner(s,orgId))throw denied();
 if(!(await s.query("SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2",[orgId,userId])).rows.length)throw denied();
 const reference=(await s.query<{wallet_id:string;user_id:string}>("SELECT wallet_id,user_id FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2",[requestId,orgId])).rows[0];
 if(!reference||reference.user_id!==userId)throw denied();
 const payer=(await s.query<{owner_type:string;owner_id:string;balance:string;remaining_held_hundredths:string}>("SELECT owner_type,owner_id,balance::text,remaining_held_hundredths::text FROM credit_wallets WHERE wallet_id=$1 FOR UPDATE",[reference.wallet_id])).rows[0];
 if(!payer||!((payer.owner_type==='user'&&payer.owner_id===userId)||(payer.owner_type==='team'&&payer.owner_id===orgId)))throw denied();
 // Fresh statement after the wallet lock: a concurrent receipt may have committed while we waited.
 const request=(await s.query<{wallet_id:string;user_id:string;own_remaining:string}>("SELECT wallet_id,user_id,CASE WHEN state='settled' THEN 0 ELSE GREATEST(reserved_hundredths-COALESCE(debited_hundredths,0),0) END::text AS own_remaining FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2",[requestId,orgId])).rows[0];
 if(!request||request.wallet_id!==reference.wallet_id||request.user_id!==userId)throw denied();
 if(payer.owner_type==='user'){
  const otherHolds=BigInt(payer.remaining_held_hundredths)-BigInt(request.own_remaining);
  if(otherHolds<0n)throw denied();
  if(creditHundredths(payer.balance)-otherHolds<=0n)throw new CreditConsumptionError('credit_required','user',userId,'insufficient_credit');
  return;
 }
 if(!await enterpriseCreditPlan(s,orgId))return;
 const quota=(await s.query<{monthly_limit:string}>('SELECT monthly_limit::text FROM member_credit_quota WHERE org_id=$1 AND user_id=$2',[orgId,userId])).rows[0];
 const cap=creditHundredths(quota?.monthly_limit??String(DEFAULT_MEMBER_MONTHLY_CREDITS));
 if((await readMemberCreditUsage(s,orgId,userId)).used>=cap)throw memberCreditLimitError(orgId);
}
