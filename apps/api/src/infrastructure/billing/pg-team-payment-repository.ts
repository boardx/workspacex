import {randomUUID} from "node:crypto";
import {CreditBalance} from "@repo/contracts/billing-credits";
import {TeamPurchaseFulfillment} from "@repo/contracts/billing-team";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import {toOrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {assessTeamPayment,type VerifiedTeamPayment} from "../../domain/billing/team-payment-decision";
import {creditHundredths,creditDecimal} from "../../application/billing/credit-consumption";
import {lockTeamFinancialOwner} from "./team-financial-owner";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {grantPaidSubscriptionPeriod,normalizeCreditPeriods} from "./pg-credit-periods";
import {teamPurchaseView,type TeamPurchaseRow} from "./pg-team-checkout-repository";
/** Only bound authoritative provider proof enters here; receipt, entitlement and financial writes commit together. */
export class PgTeamPaymentRepository{
 constructor(private readonly db:DatabasePort,private readonly clock:()=>Date=()=>new Date()){}
 async settle(orgId:string,proof:VerifiedTeamPayment){return this.db.withTenant(toOrgId(orgId),async s=>{
  const writable=await lockTeamFinancialOwner(s,orgId);await requireActivePricingEpoch(s);
  const row=(await s.query<TeamPurchaseRow&{created_by:string}>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND purchase_ref=$3 FOR UPDATE",[orgId,generation,proof.purchaseRef])).rows[0];
  if(!row)throw Error("order_not_found");const p=teamPurchaseView(row),at=this.clock();
  if(proof.provider!==p.quote.provider||!/^wx_[A-Za-z0-9_]{1,128}$/.test(proof.paymentRef)||!Number.isSafeInteger(proof.amountMinor)||proof.amountMinor<=0||!Number.isFinite(proof.paidAt.getTime()))throw Error("payment_review_required");
  await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`payment:${proof.provider}:${proof.paymentRef}`]);
  const previous=(await s.query<{purchase_ref:string;amount_minor:string;currency:string;paid_at:Date;manual_review:boolean}>("SELECT * FROM billing_team_receipts WHERE provider=$1 AND payment_ref=$2",[proof.provider,proof.paymentRef])).rows[0];
  if(previous){if(previous.purchase_ref!==p.purchaseRef||BigInt(previous.amount_minor)!==BigInt(proof.amountMinor)||previous.currency!==proof.currency||previous.paid_at.getTime()!==proof.paidAt.getTime())throw Error("payment_review_required");return {completed:true,manual:previous.manual_review};}
  // The INSERT trigger claims this real provider identity across personal and Team receipts.
  await s.query("INSERT INTO billing_team_receipts(provider,payment_ref,purchase_ref,org_id,amount_minor,currency,paid_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[proof.provider,proof.paymentRef,p.purchaseRef,orgId,proof.amountMinor,proof.currency,proof.paidAt]);
  if(!writable)return this.review(s,orgId,proof,"organization_unavailable");
  const plan=(await s.query<{plan:string;version:number}>("SELECT plan,version FROM organization_plans WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
  const license=(await s.query<{pending_purchase_ref:string|null}>("SELECT pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1 AND generation=$2 FOR UPDATE",[orgId,generation])).rows[0];
  const count=(await s.query<{n:string}>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",[orgId])).rows[0];
  const decision=assessTeamPayment(p,proof,{plan:plan?.plan??"ordinary",planVersion:plan?.version??0,pendingPurchaseRef:license?.pending_purchase_ref??null,memberCount:count?Number(count.n):Number.POSITIVE_INFINITY},at);
  if(decision.kind==="review"||row.closed_at||row.fulfilled_at)return this.review(s,orgId,proof,decision.kind==="review"?decision.reason:"purchase_already_terminal");
  await s.query("SAVEPOINT team_entitlement_apply");
  try{
   const grant=decision.grant;
   let ledgerRef:string|null=null;
   if(grant.term){
    const version=(plan?.version??0)+1,auditRef=randomUUID();
    await s.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,updated_at,billing_generation) VALUES($1,'ordinary',$2,$3,$4,$5) ON CONFLICT(org_id) DO UPDATE SET version=$2,updated_by=$3,updated_at=$4,billing_generation=$5",[orgId,version,row.created_by,at,generation]);
    await s.query("INSERT INTO organization_plan_changes(id,org_id,version,previous_plan,plan,actor_id,reason,changed_at) VALUES($1,$2,$3,$4,'ordinary',$5,$6,$7)",[auditRef,orgId,version,plan?.plan??null,row.created_by,`Team payment ${p.purchaseRef}`,at]);
    await s.query("UPDATE org_commercial_licenses SET purchased_seats=$3,pending_seats=NULL,pending_purchase_ref=NULL,updated_at=$4 WHERE org_id=$1 AND generation=$2 AND pending_purchase_ref=$5",[orgId,generation,grant.term.purchasedSeats,at,p.purchaseRef]);
    await s.query("INSERT INTO billing_team_terms(purchase_ref,org_id,generation,paid_term,next_check_at) VALUES($1,$2,$3,$4,$5)",[p.purchaseRef,orgId,generation,JSON.stringify(grant.term),grant.period!.periodEnd]);
    if(grant.credits>0){
     const invoiceRef=`team-term:${p.purchaseRef}:0`;
     await grantPaidSubscriptionPeriod(s,{ownerType:"team",userId:orgId,subscriptionRef:p.purchaseRef,invoiceRef,planRef:p.quote.sku,periodStart:new Date(grant.period!.periodStart),periodEnd:new Date(grant.period!.periodEnd),credits:grant.credits},at);
     ledgerRef=await this.periodLedger(s,orgId,invoiceRef);
    }
    const fulfillment=TeamPurchaseFulfillment.parse({receiptRef:proof.paymentRef,auditRef,ledgerRef,appliedAt:at.toISOString(),paidTerm:grant.term,firstCreditsApplied:grant.credits,firstCreditPeriod:grant.period});
    await this.fulfill(s,orgId,p.purchaseRef,fulfillment,at);
   }else{
    await s.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('team',$1) ON CONFLICT(owner_type,owner_id) DO NOTHING",[orgId]);
    const wallet=(await s.query<{wallet_id:string}>("SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1 FOR UPDATE",[orgId])).rows[0];
    if(!wallet)throw Error("dependency_unavailable");await normalizeCreditPeriods(s,wallet.wallet_id,at);
    const state=(await s.query<{balance:string;total_purchased:string}>("SELECT balance::text,total_purchased::text FROM credit_wallets WHERE wallet_id=$1",[wallet.wallet_id])).rows[0];
    if(!state)throw Error("dependency_unavailable");
    const delta=BigInt(grant.credits)*100n,balance=creditHundredths(state.balance)+delta,limit=BigInt(CreditBalance.maxValue!)*100n;
    if(balance>limit||creditHundredths(state.total_purchased)+delta>limit)throw Error("credit_balance_unrepresentable");
    await s.query("UPDATE credit_wallets SET balance=$2,total_purchased=total_purchased+$3,updated_at=$4 WHERE wallet_id=$1",[wallet.wallet_id,creditDecimal(balance),grant.credits,at]);
    const ledger=(await s.query<{txn_id:string}>("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'purchase',1,$2,$3,'payment_order',$4) RETURNING txn_id",[wallet.wallet_id,grant.credits,creditDecimal(balance),p.purchaseRef])).rows[0];
    if(!ledger)throw Error("dependency_unavailable");ledgerRef=ledger.txn_id;
    await this.fulfill(s,orgId,p.purchaseRef,TeamPurchaseFulfillment.parse({receiptRef:proof.paymentRef,auditRef:ledgerRef,ledgerRef,appliedAt:at.toISOString(),paidTerm:null,firstCreditsApplied:grant.credits,firstCreditPeriod:null}),at);
   }
   await s.query("RELEASE SAVEPOINT team_entitlement_apply");return {completed:true,manual:false};
  }catch(error){
   await s.query("ROLLBACK TO SAVEPOINT team_entitlement_apply");await s.query("RELEASE SAVEPOINT team_entitlement_apply");
   if(error instanceof Error&&error.message==="credit_balance_unrepresentable")return this.review(s,orgId,proof,error.message);
   throw error;
  }
 });}
 private async periodLedger(s:TenantSession,orgId:string,invoiceRef:string){
  const row=(await s.query<{txn_id:string}>("SELECT t.txn_id FROM credit_transactions t JOIN credit_subscription_periods p ON t.source_id=p.period_id::text JOIN credit_wallets w ON w.wallet_id=p.wallet_id WHERE w.owner_type='team' AND w.owner_id=$1 AND p.invoice_ref=$2 AND t.type='subscription_grant'",[orgId,invoiceRef])).rows[0];
  if(!row)throw Error("dependency_unavailable");return row.txn_id;
 }
 private async fulfill(s:TenantSession,orgId:string,ref:string,receipt:unknown,at:Date){await s.query("UPDATE billing_team_purchases SET fulfillment=$3,fulfilled_at=$4 WHERE org_id=$1 AND purchase_ref=$2",[orgId,ref,JSON.stringify(receipt),at]);}
 private async review(s:TenantSession,orgId:string,p:VerifiedTeamPayment,reason:string){
  await s.query("UPDATE billing_team_receipts SET manual_review=true,manual_reason=$3 WHERE provider=$1 AND payment_ref=$2",[p.provider,p.paymentRef,reason]);
  await s.query("UPDATE billing_team_purchases SET payment_review_required=true WHERE org_id=$1 AND purchase_ref=$2",[orgId,p.purchaseRef]);return {completed:true,manual:true};
 }
}
