import {randomUUID} from "node:crypto";
import {MONTHLY_PASS_PRODUCT} from "@repo/contracts/billing-subscription";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {SubscriptionError} from "../../application/billing/billing-subscription-service";
import {monthlyPassEnd,validateMonthlyCheckout,type MonthlyOrder,type MonthlyPassRepository} from "../../application/billing/monthly-pass-service";
import {readLegacySubscription} from "./pg-billing-subscription-repository";
import {grantPaidSubscriptionPeriod} from "./pg-credit-periods";
import {MONTHLY_PASS_SQL as SQL} from "./monthly-pass-sql";
import {assertBillingGlobalStatement,BILLING_GLOBAL_SQL} from "./billing-global-boundary";
type Row={order_id:string;user_id:string;state:MonthlyOrder["state"];session_ref:string|null;payment_ref:string|null;created_at:Date;period_start:Date|null;period_end:Date|null;remaining_hundredths?:string};
const map=(r:Row):MonthlyOrder=>({orderId:r.order_id,userId:r.user_id,state:r.state,sessionRef:r.session_ref,createdAt:r.created_at,periodStart:r.period_start,periodEnd:r.period_end,remainingCredits:Number(r.remaining_hundredths??0)/100});
const lock=(s:TenantSession,id:string)=>s.query(BILLING_GLOBAL_SQL.stripeUserLock,[`billing-subscription:${id}`]);
export class PgMonthlyPassRepository implements MonthlyPassRepository {
 constructor(private readonly db:DatabasePort){}
 latest(p:Principal){assertPrincipal(p);return this.db.withTenant(p.orgId,async s=>{const r=(await s.query<Row>(SQL.latest,[p.userId])).rows[0];return r?map(r):null;});}
 reserve(p:Principal){assertPrincipal(p);return this.db.withTenant(p.orgId,async s=>{
  await lock(s,p.userId);
  const legacy=await readLegacySubscription(s,p.userId);
  const legacyExpired=legacy?.cancelAtPeriodEnd&&legacy.currentPeriodEnd&&Date.parse(legacy.currentPeriodEnd)<=Date.now();
  if(legacy&&!legacyExpired&&!["canceled","incomplete_expired","none"].includes(legacy.status))throw new SubscriptionError("already_subscribed");
  if((await s.query(SQL.active,[p.userId])).rows.length)throw new SubscriptionError("already_subscribed");
  const pending=(await s.query<Row>(SQL.pending,[p.userId])).rows[0];if(pending)return map(pending);
  return map((await s.query<Row>(SQL.insert,[randomUUID(),p.userId])).rows[0]!);
 });}
 async bind(p:Principal,orderId:string,sessionRef:string){assertPrincipal(p);await this.db.withTenant(p.orgId,async s=>{
  await lock(s,p.userId);if(!(await s.query(SQL.bind,[orderId,p.userId,sessionRef])).rows.length)throw Error("monthly_order_binding_conflict");
 });}
 async expire(p:Principal,orderId:string,sessionRef:string){assertPrincipal(p);await this.db.withTenant(p.orgId,async s=>{await lock(s,p.userId);await s.query(SQL.expire,[orderId,p.userId,sessionRef]);});}
 async settle(orderId:string,session:Record<string,unknown>){
  // Always recheck amount and identity at the financial boundary; environment is checked by the provider service.
  validateMonthlyCheckout(session,orderId,session.livemode as boolean);
  await this.db.withoutTenant(async raw=>{
   const s:TenantSession={query(sql,params){assertBillingGlobalStatement(sql);return raw.query(sql,params);}};
   const owner=(await s.query<{user_id:string}>(SQL.owner,[orderId])).rows[0];if(!owner)throw Error("monthly_order_unknown");
   await lock(s,owner.user_id);const row=(await s.query<Row>(SQL.lock,[orderId])).rows[0]!;
   // A lost creation response can be recovered by its signed, authoritatively retrieved Checkout.
   if(row.session_ref&&row.session_ref!==session.id)throw Error("monthly_order_binding_conflict");
   if(row.state==="paid"){if(row.payment_ref!==session.payment_intent)throw Error("monthly_order_replay_mismatch");return;}
   if(row.state!=="pending")throw Error("monthly_order_closed");
   if((await s.query(SQL.active,[owner.user_id])).rows.length)throw Error("monthly_order_overlap");
   const start=new Date(),end=monthlyPassEnd(start);
   await grantPaidSubscriptionPeriod(s,{userId:owner.user_id,subscriptionRef:`pass_${orderId}`,invoiceRef:session.payment_intent as string,planRef:MONTHLY_PASS_PRODUCT,periodStart:start,periodEnd:end});
   await s.query(SQL.bind,[orderId,owner.user_id,session.id]);
   await s.query(SQL.paid,[orderId,session.payment_intent,start,end]);
  });
 }
}
