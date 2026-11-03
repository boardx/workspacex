import {TeamPaidTerm} from "@repo/contracts/billing-team";
import {creditMonthBoundary,creditMonthWindowAt} from "@repo/contracts/billing-credit-calendar";
import type {TenantSession} from "../../application/ports/database.port";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {grantPaidSubscriptionPeriod,normalizeCreditPeriods} from "./pg-credit-periods";
/** Caller holds epoch -> organization -> license locks. Paid plans survive an Enterprise upgrade. */
export async function grantDueTeamTerms(s:TenantSession,orgId:string,at:Date){
 const rows=(await s.query<{purchase_ref:string;paid_term:unknown;quote:unknown}>("SELECT t.purchase_ref,t.paid_term,p.quote FROM billing_team_terms t JOIN billing_team_purchases p USING(purchase_ref) WHERE t.org_id=$1 AND t.generation=$2 ORDER BY t.purchase_ref",[orgId,generation])).rows;
 const wallet=(await s.query<{wallet_id:string}>("SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1 FOR UPDATE",[orgId])).rows[0];
 if(wallet)await normalizeCreditPeriods(s,wallet.wallet_id,at);
 for(const row of rows){
  const term=TeamPaidTerm.parse(row.paid_term),anchor=new Date(term.purchaseAnchor),end=new Date(term.paidPeriodEnd);
  if(at<new Date(term.paidPeriodStart))continue;
  if(at>=end){await s.query("UPDATE billing_team_terms SET next_check_at=NULL WHERE purchase_ref=$1",[row.purchase_ref]);continue;}
  const window=creditMonthWindowAt(anchor,at);
  if(!window||window.start<new Date(term.paidPeriodStart)||window.end>end)throw Error("payment_review_required");
  const quote=row.quote as {sku:string};
  if(typeof quote.sku!=="string"||!quote.sku)throw Error("payment_review_required");
  // Missed expired windows never mint a new ledger; the current original-anchor month alone is due.
  await grantPaidSubscriptionPeriod(s,{ownerType:"team",userId:orgId,subscriptionRef:row.purchase_ref,invoiceRef:`team-term:${row.purchase_ref}:${window.offset}`,planRef:quote.sku,periodStart:window.start,periodEnd:window.end,credits:term.monthlyCredits},at);
  await s.query("UPDATE billing_team_terms SET next_check_at=$2 WHERE purchase_ref=$1",[row.purchase_ref,creditMonthBoundary(anchor,window.offset+1)]);
 }
}
