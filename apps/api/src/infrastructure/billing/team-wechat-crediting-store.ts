import type {DatabasePort} from "../../application/ports/database.port";
import type {BillingCreditingStore,VerifiedPaymentReceipt} from "../../application/billing/billing-notify-ports";
import {PaymentNoticeError} from "../../application/billing/billing-notify-ports";
import {toOrgId} from "../../domain/org-id";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {BILLING_GLOBAL_SQL as GLOBAL,assertBillingGlobalStatement} from "./billing-global-boundary";
import {teamPurchaseView,type TeamPurchaseRow} from "./pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "./pg-team-payment-repository";
import {TeamWechatPaymentClient} from "./team-wechat-payment-client";
/** Team financial routing precedes the unchanged personal/legacy chain, never a second personal issuer. */
export class TeamWechatCreditingStore implements BillingCreditingStore{
 constructor(private readonly db:DatabasePort,private readonly client:TeamWechatPaymentClient,private readonly payments:PgTeamPaymentRepository,private readonly previous:BillingCreditingStore){}
 async accept(notice:VerifiedPaymentReceipt){
  const orgId=await this.db.withoutTenant(async raw=>{
   assertBillingGlobalStatement(GLOBAL.teamPurchaseOrg);
   return (await raw.query<{org_id:string|null}>(GLOBAL.teamPurchaseOrg,[notice.orderNo])).rows[0]?.org_id;
  });
  if(!orgId)return this.previous.accept(notice);
  if(!notice.signatureVerified)throw new PaymentNoticeError("signature_invalid",false,notice.orderNo);
  const p=await this.db.withTenant(toOrgId(orgId),async s=>{
   await requireActivePricingEpoch(s);const row=(await s.query<TeamPurchaseRow>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND purchase_ref=$2",[orgId,notice.orderNo])).rows[0];
   if(!row)throw Error("order_not_found");return teamPurchaseView(row);
  });
  const state=await this.client.read(p);
  if(state.state!=="paid")throw new PaymentNoticeError("provider_unavailable",true,notice.orderNo);
  if(notice.tradeState!=="SUCCESS"||notice.amountFen!==state.amountMinor||notice.currency!==state.currency||!notice.transactionId||!notice.paidAt||state.paymentRef!==`wx_${notice.transactionId}`||state.paidAt.getTime()!==Date.parse(notice.paidAt))throw new PaymentNoticeError("order_mismatch",true,notice.orderNo);
  const result=await this.payments.settle(orgId,{provider:"wechat",purchaseRef:p.purchaseRef,paymentRef:state.paymentRef,paidAt:state.paidAt,amountMinor:state.amountMinor,currency:state.currency});
  await this.db.withoutTenant(async s=>{assertBillingGlobalStatement(GLOBAL.insertEvent);await s.query(GLOBAL.insertEvent,[notice.providerEventId,notice.orderNo,"ok",true]);});
  return result;
 }
 processOne(id:string){return this.previous.processOne(id);}
 due(){return this.previous.due();}
 auditRejection(verified:boolean,orderNo:string|null){return this.previous.auditRejection(verified,orderNo);}
}
