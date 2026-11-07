import {MONTHLY_PASS_AMOUNT_FEN} from "@repo/contracts/billing-subscription";
import type {BillingCreditingStore,VerifiedPaymentReceipt} from "../../application/billing/billing-notify-ports";
import {PaymentNoticeError} from "../../application/billing/billing-notify-ports";
import type {DatabasePort} from "../../application/ports/database.port";
import type {MonthlyPassService} from "../../application/billing/monthly-pass-service";
import type {WechatMonthlyPassClient} from "./wechat-monthly-pass-client";
import {assertBillingGlobalStatement} from "./billing-global-boundary";
import {MONTHLY_PASS_SQL as SQL} from "./monthly-pass-sql";
/** Verified notifications dispatch by reserved merchant identity, never browser product input. */
export class MonthlyWechatCreditingStore implements BillingCreditingStore {
 constructor(private readonly db:DatabasePort,private readonly legacy:BillingCreditingStore,private readonly monthly:MonthlyPassService,private readonly client:WechatMonthlyPassClient){}
 async accept(receipt:VerifiedPaymentReceipt){
  assertBillingGlobalStatement(SQL.wechatOrder);
  const monthly=await this.db.withoutTenant(async s=>(await s.query(SQL.wechatOrder,[receipt.orderNo])).rows.length>0);
  if(!monthly)return this.legacy.accept(receipt);
  if(receipt.tradeState!=="SUCCESS"||receipt.amountFen!==MONTHLY_PASS_AMOUNT_FEN||receipt.currency!=="CNY"||!receipt.transactionId)throw new PaymentNoticeError("order_mismatch",receipt.signatureVerified,receipt.orderNo);
  const session=await this.client.retrieve(receipt.orderNo);
  if(session.payment_intent!==`wx_${receipt.transactionId}`)throw new PaymentNoticeError("transaction_conflict",receipt.signatureVerified,receipt.orderNo);
  await this.monthly.accept(session);return {completed:true,manual:false};
 }
 processOne(id:string){return this.legacy.processOne(id);}
 due(){return this.legacy.due();}
 auditRejection(verified:boolean,orderNo:string|null){return this.legacy.auditRejection(verified,orderNo);}
}
