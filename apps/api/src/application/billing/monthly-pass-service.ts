import {MONTHLY_PASS_AMOUNT_FEN, MONTHLY_PASS_PRODUCT, MONTHLY_SUBSCRIPTION_CREDITS, SubscriptionInfo} from "@repo/contracts/billing-subscription";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {SubscriptionError} from "./billing-subscription-service";
export type MonthlyOrder={orderId:string;userId:string;state:"pending"|"paid"|"expired";sessionRef:string|null;createdAt:Date;periodStart:Date|null;periodEnd:Date|null;remainingCredits:number};
export interface MonthlyPassRepository {
 latest(principal:Principal):Promise<MonthlyOrder|null>;
 reserve(principal:Principal):Promise<MonthlyOrder>;
 bind(principal:Principal,orderId:string,sessionRef:string):Promise<void>;
 settle(orderId:string,session:Record<string,unknown>):Promise<void>;
 expire(principal:Principal,orderId:string,sessionRef:string):Promise<void>;
}
export interface MonthlyCheckoutProvider {
 enabled():boolean;
 liveMode():boolean;
 create(order:MonthlyOrder):Promise<Record<string,unknown>>;
 retrieve(id:string):Promise<Record<string,unknown>>;
}
export function monthlyPassEnd(start:Date):Date {
 const result=new Date(start);const day=result.getUTCDate();result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()+1);
 const last=new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();result.setUTCDate(Math.min(day,last));return result;
}
export function validateMonthlyCheckout(value:Record<string,unknown>,orderId:string,liveMode:boolean):void {
 const meta=value.metadata as Record<string,unknown>|null;
 if(typeof liveMode!=="boolean"||value.object!=="checkout.session"||value.mode!=="payment"||value.status!=="complete"||value.payment_status!=="paid"||
 value.amount_total!==MONTHLY_PASS_AMOUNT_FEN||value.currency!=="cny"||value.livemode!==liveMode||value.client_reference_id!==orderId||
 meta?.product!==MONTHLY_PASS_PRODUCT||meta.order_ref!==orderId||value.subscription!=null||typeof value.id!=="string"||!/^cs_[A-Za-z0-9_]+$/.test(value.id)||
 typeof value.payment_intent!=="string"||!/^pi_[A-Za-z0-9_]+$/.test(value.payment_intent))throw Error("monthly_checkout_mismatch");
}
export class MonthlyPassService {
 constructor(private readonly repository:MonthlyPassRepository,private readonly provider:MonthlyCheckoutProvider){}
 private async synchronize(principal:Principal){
  const order=await this.repository.latest(principal);
  if(order?.state==="pending"&&order.sessionRef){
   const session=await this.provider.retrieve(order.sessionRef);
   if(session.id!==order.sessionRef)throw Error("monthly_checkout_mismatch");
   if(session.status==="complete"&&session.payment_status==="paid")await this.accept(session);
   else if(session.status==="expired")await this.repository.expire(principal,order.orderId,order.sessionRef);
  }
  return this.repository.latest(principal);
 }
 async info(principal:Principal){
  assertPrincipal(principal);const order=await this.synchronize(principal);if(!order)return null;
  const active=order.state==="paid"&&!!order.periodEnd&&order.periodEnd.getTime()>Date.now();
  return SubscriptionInfo.parse({status:active?"active":order.state==="pending"?"none":"canceled",planRef:MONTHLY_PASS_PRODUCT,
   currentPeriodEnd:order.periodEnd?.toISOString()??null,cancelAtPeriodEnd:true,purchaseMode:"manual_monthly",checkoutPending:order.state==="pending",
   creditGrant:{status:active?"granted":order.state==="paid"?"expired":"none",grant:order.state==="paid"?{credits:MONTHLY_SUBSCRIPTION_CREDITS,remainingCredits:active?order.remainingCredits:0,periodStart:order.periodStart!.toISOString(),periodEnd:order.periodEnd!.toISOString()}:null}});
 }
 async checkout(principal:Principal){
  assertPrincipal(principal);if(!this.provider.enabled())throw new SubscriptionError("payment_provider_not_configured");
  await this.synchronize(principal);const order=await this.repository.reserve(principal);
  // Ambiguous requests retain the same order/idempotency key. Never issue another charge on a timeout.
  if(!order.sessionRef&&Date.now()-order.createdAt.getTime()>23*60*60*1000)throw new SubscriptionError("dependency_unavailable");
  const session=order.sessionRef?await this.provider.retrieve(order.sessionRef):await this.provider.create(order);
  if (session.status === "complete" && session.payment_status === "paid") { await this.accept(session); throw new SubscriptionError("already_subscribed"); }
  if(typeof session.id!=="string"||typeof session.url!=="string")throw new SubscriptionError("dependency_unavailable");
  await this.repository.bind(principal,order.orderId,session.id);return {url:session.url};
 }
 async accept(session:Record<string,unknown>){
  const id=(session.metadata as Record<string,unknown>|null)?.order_ref;if(typeof id!=="string")throw Error("unbound_monthly_checkout");
  validateMonthlyCheckout(session,id,this.provider.liveMode());await this.repository.settle(id,session);
 }
}
