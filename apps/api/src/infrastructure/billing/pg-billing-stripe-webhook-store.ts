import { requireLegacySubscriptionEpoch } from "./legacy-billing-epoch";
import {MONTHLY_PASS_SQL} from "./monthly-pass-sql";
import { SubscriptionStatus } from "@repo/contracts/billing-subscription";
import { createHash } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { StripeEvent, StripeSnapshotProvider, StripeWebhookStore } from "../../application/billing/billing-stripe-webhook-service";
import { assertBillingGlobalStatement, BILLING_GLOBAL_SQL as SQL } from "./billing-global-boundary";
import {grantPaidSubscriptionPeriod} from "./pg-credit-periods";
import {paidMonthlyCreditPeriod,type PaidCreditPeriod} from "./stripe-paid-credit-period";
const ref = (value: unknown, kind: string) => { if(typeof value!=="string" || value.length>255 || !new RegExp(`^${kind}_[A-Za-z0-9_]+$`).test(value)) throw Error("invalid_reference"); return value; };
function snapshot(value: Record<string,unknown>) {
  const state = SubscriptionStatus.safeParse(value.status);
  // A future state may also change its item shape. Preserve identity and fail closed
  // before applying assumptions that belong only to supported subscription states.
  if (!state.success || state.data === "none") return { status: null };
  const items = value.items as { data?: { price?: { id?: unknown; recurring?: unknown }; current_period_start?: unknown; current_period_end?: unknown }[]; has_more?: unknown } | undefined;
  if(!items || items.has_more !== false || !Array.isArray(items.data) || items.data.length!==1) throw Error("unsupported_items");
  const item=items.data[0]!;
  if(!item.price?.recurring || typeof value.status!=="string" || typeof value.cancel_at_period_end!=="boolean") throw Error("invalid_snapshot");
  const seconds = (v: unknown, nullable=false) => { if(nullable && (v===null||v===undefined)) return null; if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||v>253402300799) throw Error("invalid_period"); return v; };
  return { status:value.status, plan:ref(item.price.id,"price"), start:seconds(item.current_period_start), end:seconds(item.current_period_end), cancel:value.cancel_at_period_end, trialStart:seconds(value.trial_start,true), trialEnd:seconds(value.trial_end,true) };
}
export class PgBillingStripeWebhookStore implements StripeWebhookStore {
  constructor(private readonly db: DatabasePort) {}
  async apply(event: StripeEvent, provider: StripeSnapshotProvider, expectedCredit?: PaidCreditPeriod & {userId:string}): Promise<boolean> {
    return this.db.withoutTenant(async session => {
      await session.query("SET LOCAL statement_timeout = '12000ms'"); await session.query("SET LOCAL lock_timeout = '2000ms'");
      const s: TenantSession = { query(sql,params) { assertBillingGlobalStatement(sql); return session.query(sql,params); } };
      await requireLegacySubscriptionEpoch(s);
      await s.query(SQL.stripeEventLock,[`billing-stripe-event:${event.id}`]);
      const seen=(await s.query<{provider:string;signature_verified:boolean;result:string}>(SQL.readEvent,[event.id])).rows[0];
      const paid=["invoice.paid","invoice.payment_succeeded"].includes(event.type);
      if(expectedCredit&&(!paid||event.object.id!==expectedCredit.invoiceRef))throw Error("credit_reconciliation_mismatch");
      if(seen) { if(seen.provider!=="stripe"||!seen.signature_verified||!["ok","ignored"].includes(seen.result)) throw Error("event_conflict"); if(!(paid&&(seen.result==="ignored"||expectedCredit)))return true; }
      const checkout = event.type === "checkout.session.completed";
      const supported=paid||checkout||["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.payment_failed"].includes(event.type);
      if(!supported) return (await s.query<{result:string}>(SQL.stripeApply,[event.id,null,null,null,null,false])).rows[0]?.result==="done";
      let paidInvoice:Record<string,unknown>|null=null;
      let hash: string | null = null, subscriptionRef: string, customerRef: string | undefined;
      if(paid){
        if(!provider.invoice||!provider.price)return false;
        paidInvoice=await provider.invoice(ref(event.object.id,"in"));
        const parent=paidInvoice.parent as {type?:unknown;subscription_details?:{subscription?:unknown}}|null;
        if(!parent||parent.type!=="subscription_details")return expectedCredit?false:(await s.query<{result:string}>(SQL.stripeApply,[event.id,null,null,null,null,false])).rows[0]?.result==="done";
        subscriptionRef=ref(parent.subscription_details?.subscription,"sub");customerRef=ref(paidInvoice.customer,"cus");
      }else if(checkout) {
        // Signed event supplies only opaque session identity. All binding facts are reread server-side.
        const value=await provider.checkout(ref(event.object.id,"cs"));
        if(typeof value.client_reference_id!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(value.client_reference_id)) throw Error("unbound_checkout");
        hash=createHash("sha256").update(value.client_reference_id).digest("hex");
        subscriptionRef=ref(value.subscription,"sub"); customerRef=ref(value.customer,"cus");
      } else if(event.type === "invoice.payment_failed") {
        const parent=event.object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
        subscriptionRef=ref(parent?.subscription_details?.subscription,"sub");
      } else subscriptionRef=ref(event.object.id,"sub");
      const owner=(await s.query<{user_id:string;customer_ref?:string}>(checkout?SQL.stripeIntentOwner:SQL.stripeBindingOwner,[checkout?hash:subscriptionRef])).rows[0];
      if(!owner) return false;
      await s.query(SQL.stripeUserLock,[`billing-subscription:${owner.user_id}`]);
      // Retrieve under the user transaction lock: delayed snapshots cannot cross a later binding or state update.
      let customer: string, data: ReturnType<typeof snapshot>;
      try {
        const value=await provider.subscription(subscriptionRef);
        customer=ref(value.customer,"cus");
        if(customerRef && customerRef!==customer) throw Error("checkout_relation_mismatch");
        data=snapshot(value);
      } catch {
        // Commit uncertainty before returning retry. Throwing here rolls the transaction
        // back and would incorrectly leave a previous active snapshot confirmed.
        // A complete authoritative Checkout can retain unresolved correlation, but
        // cannot create a known snapshot or management session without verification.
        const trustedCustomer=customerRef ?? owner.customer_ref;
        if (!trustedCustomer) return false;
        const recorded=(await s.query<{result:string}>(SQL.stripeApply,[event.id,hash,subscriptionRef,trustedCustomer,JSON.stringify({status:null}),checkout])).rows[0]?.result==="done";
        return !expectedCredit&&recorded;
      }
      // Historical ignored paid events already have immutable event audit rows.
      // Reconcile their separately keyed credit period using the verified binding;
      // do not replay snapshot mutation through the already-consumed event ID.
      if(paid && owner.customer_ref!==customer) throw Error("paid_binding_mismatch");
      let period:PaidCreditPeriod|null=null;
      if(paidInvoice&&data.status!==null){
        const price=await provider.price!(data.plan!);
        period=paidMonthlyCreditPeriod(paidInvoice,price,{subscriptionRef,customerRef:customer,planRef:data.plan!,periodStart:new Date(data.start!*1000).toISOString(),periodEnd:new Date(data.end!*1000).toISOString(),status:SubscriptionStatus.parse(data.status)});
      }
      if(period && !(await s.query(MONTHLY_PASS_SQL.grantedIdentity,[owner.user_id,period.invoiceRef,period.subscriptionRef,period.planRef,period.periodStart,period.periodEnd])).rows.length){
        const key=`legacy:${period.invoiceRef}`;
        if((await s.query(MONTHLY_PASS_SQL.conflict,[key])).rows.length)return false;
        if((await s.query(MONTHLY_PASS_SQL.overlapping,[owner.user_id,period.periodStart,period.periodEnd])).rows.length){
          await s.query(MONTHLY_PASS_SQL.recordConflict,[key,owner.user_id,period.invoiceRef,subscriptionRef]);
          return false; // Persist a reconciliation case; never silently grant a second overlapping paid period.
        }
      }
      // Backfill success means the exact reviewed period was granted/validated in this
      // transaction. A changed locked reread rolls back before consuming its event ID.
      if(expectedCredit&&(data.status!=="active"||owner.user_id!==expectedCredit.userId||!period||
        period.subscriptionRef!==expectedCredit.subscriptionRef||period.invoiceRef!==expectedCredit.invoiceRef||period.planRef!==expectedCredit.planRef||
        period.periodStart.getTime()!==expectedCredit.periodStart.getTime()||period.periodEnd.getTime()!==expectedCredit.periodEnd.getTime()))throw Error("credit_reconciliation_mismatch");
      // Existing audits stay immutable; explicit reconciliation can recover an older
      // ok-without-grant event through the independently unique financial period.
      const applied=!!seen || (await s.query<{result:string}>(SQL.stripeApply,[event.id,hash,subscriptionRef,customer,JSON.stringify(data),checkout])).rows[0]?.result==="done";
      if(applied&&period)await grantPaidSubscriptionPeriod(s,{...period,userId:owner.user_id});
      return applied;
    });
  }
}
