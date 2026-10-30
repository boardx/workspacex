import {MONTHLY_PASS_PRODUCT} from "@repo/contracts/billing-subscription";
import type {StripeEvent,StripeSnapshotProvider,StripeWebhookStore} from "../../application/billing/billing-stripe-webhook-service";
import type {MonthlyPassService} from "../../application/billing/monthly-pass-service";
import type {StripeMonthlyPassClient} from "./stripe-monthly-pass-client";
import type {DatabasePort} from "../../application/ports/database.port";
import {BILLING_GLOBAL_SQL} from "./billing-global-boundary";
export class MonthlyStripeWebhookStore implements StripeWebhookStore {
 constructor(private readonly db:DatabasePort,private readonly legacy:StripeWebhookStore,private readonly monthly:MonthlyPassService,private readonly client:StripeMonthlyPassClient){}
 async apply(event:StripeEvent,provider:StripeSnapshotProvider){
  if(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)&&event.object.mode==="payment"){
   if(typeof event.object.id!=="string")throw Error("invalid_checkout");
   const session=await this.client.retrieve(event.object.id);
   if((session.metadata as Record<string,unknown>|null)?.product===MONTHLY_PASS_PRODUCT)await this.monthly.accept(session);
   // Financial identity is the immutable Checkout/PaymentIntent pair, not event delivery order.
   return this.db.withoutTenant(async s=>{
    await s.query(BILLING_GLOBAL_SQL.stripeEventLock,[`billing-stripe-event:${event.id}`]);
    const seen=(await s.query<{provider:string;signature_verified:boolean;result:string}>(BILLING_GLOBAL_SQL.readEvent,[event.id])).rows[0];
    if(seen){if(seen.provider!=="stripe"||!seen.signature_verified||!["ok","ignored"].includes(seen.result))throw Error("event_conflict");return true;}
    return (await s.query<{result:string}>(BILLING_GLOBAL_SQL.stripeApply,[event.id,null,null,null,null,false])).rows[0]?.result==="done";
   });
  }
  return this.legacy.apply(event,provider);
 }
}
