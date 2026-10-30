import {createHash} from "node:crypto";
import {SubscriptionStatus} from "@repo/contracts/billing-subscription";
import type {DatabasePort} from "../../application/ports/database.port";
import type {StripeSnapshotProvider} from "../../application/billing/billing-stripe-webhook-service";
import {PgBillingStripeWebhookStore} from "./pg-billing-stripe-webhook-store";
import {paidMonthlyCreditPeriod} from "./stripe-paid-credit-period";

type Candidate={user_id:string;subscription_ref:string;customer_ref:string;plan_ref:string|null;status:string};
export type BackfillOptions={apply:boolean;plans:readonly string[];after?:string;until?:string;limit:number};
/** Operator-only page. Uses app credentials and owner-global billing metadata, never tenant content.
 * Apply re-enters the very same authoritative invoice/period transaction as signed webhooks.
 */
export async function backfillSubscriptionCredits(db:DatabasePort,provider:StripeSnapshotProvider,options:BackfillOptions){
 if(!Number.isSafeInteger(options.limit)||options.limit<1||options.limit>100)throw Error("invalid_page_size");
 const until=options.until??await db.withoutTenant(async s=>(await s.query<{last:string|null}>("SELECT max(user_id) AS last FROM billing_subscriptions")).rows[0]?.last??"");
 const rows=await db.withoutTenant(async s=>(await s.query<Candidate>("SELECT user_id,subscription_ref,customer_ref,plan_ref,status FROM billing_subscriptions WHERE user_id>$1 AND user_id<=$2 ORDER BY user_id LIMIT $3",[options.after??"",until,options.limit])).rows);
 const report={scanned:rows.length,eligible:0,applied:0,blocked:0,skipped:0,until,nextAfter:rows.length===options.limit?rows.at(-1)!.user_id:null,items:[] as {userId:string;subscriptionRef:string;planRef:string|null;reason:string}[]};
 for(const row of rows){
  let reason="verification_failed";
  try{
   if(!["active","trialing","past_due"].includes(row.status)){report.skipped++;continue;}
   if(!row.plan_ref||!options.plans.includes(row.plan_ref)){reason="unmapped_plan";throw Error(reason);}
   if(!provider.invoice||!provider.price)throw Error("paid_reads_required");
   const snapshot=await provider.subscription(row.subscription_ref);
   const items=snapshot.items as {has_more?:boolean;data?:{price?:{id?:unknown};current_period_start?:unknown;current_period_end?:unknown}[]}|undefined;
   if(snapshot.id!==row.subscription_ref||snapshot.customer!==row.customer_ref||snapshot.status!=="active"||items?.has_more!==false||items.data?.length!==1)throw Error("unconfirmed_binding");
   const item=items.data[0]!;
   if(item.price?.id!==row.plan_ref||typeof item.current_period_start!=="number"||typeof item.current_period_end!=="number"||typeof snapshot.latest_invoice!=="string")throw Error("unconfirmed_period");
   const periodStart=new Date(item.current_period_start*1000),periodEnd=new Date(item.current_period_end*1000);
   if(periodStart.getTime()>Date.now()||periodEnd.getTime()<=Date.now())throw Error("not_current_period");
   const invoice=await provider.invoice(snapshot.latest_invoice),price=await provider.price(row.plan_ref);
   const period=paidMonthlyCreditPeriod(invoice,price,{subscriptionRef:row.subscription_ref,customerRef:row.customer_ref,planRef:row.plan_ref,status:SubscriptionStatus.parse(snapshot.status),periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString()});
   if(!period){reason="unsupported_paid_period";throw Error(reason);}
   // Even a paid late invoice must be for the actual current cycle, never a historic refill.
   if(period.periodStart.getTime()!==periodStart.getTime()||period.periodEnd.getTime()!==periodEnd.getTime())throw Error("not_current_invoice");
   report.eligible++;
   if(options.apply){
    const id="evt_creditbackfill_"+createHash("sha256").update(`${row.subscription_ref}:${period.invoiceRef}`).digest("hex");
    if(!await new PgBillingStripeWebhookStore(db).apply({id,type:"invoice.paid",object:{id:period.invoiceRef}},provider))throw Error("retry_required");
    report.applied++;
   }
   report.items.push({userId:row.user_id,subscriptionRef:row.subscription_ref,planRef:row.plan_ref,reason:options.apply?"reconciled":"verified_dry_run"});
  }catch{report.blocked++;report.items.push({userId:row.user_id,subscriptionRef:row.subscription_ref,planRef:row.plan_ref,reason});}
 }
 return report;
}
