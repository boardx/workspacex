import { SubscriptionStatus } from "@repo/contracts/billing-subscription";
import { createHash } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { StripeEvent, StripeSnapshotProvider, StripeWebhookStore } from "../../application/billing/billing-stripe-webhook-service";
import { assertBillingGlobalStatement, BILLING_GLOBAL_SQL as SQL } from "./billing-global-boundary";
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
  async apply(event: StripeEvent, provider: StripeSnapshotProvider): Promise<boolean> {
    return this.db.withoutTenant(async session => {
      await session.query("SET LOCAL statement_timeout = '12000ms'"); await session.query("SET LOCAL lock_timeout = '2000ms'");
      const s: TenantSession = { query(sql,params) { assertBillingGlobalStatement(sql); return session.query(sql,params); } };
      await s.query(SQL.stripeEventLock,[`billing-stripe-event:${event.id}`]);
      const seen=(await s.query<{provider:string;signature_verified:boolean;result:string}>(SQL.readEvent,[event.id])).rows[0];
      if(seen) { if(seen.provider!=="stripe"||!seen.signature_verified||!["ok","ignored"].includes(seen.result)) throw Error("event_conflict"); return true; }
      const checkout = event.type === "checkout.session.completed";
      const supported=checkout||["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.payment_failed"].includes(event.type);
      if(!supported) return (await s.query<{result:string}>(SQL.stripeApply,[event.id,null,null,null,null,false])).rows[0]?.result==="done";
      let hash: string | null = null, subscriptionRef: string, customerRef: string | undefined;
      if(checkout) {
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
        return (await s.query<{result:string}>(SQL.stripeApply,[event.id,hash,subscriptionRef,trustedCustomer,JSON.stringify({status:null}),checkout])).rows[0]?.result==="done";
      }
      return (await s.query<{result:string}>(SQL.stripeApply,[event.id,hash,subscriptionRef,customer,JSON.stringify(data),checkout])).rows[0]?.result==="done";
    });
  }
}
