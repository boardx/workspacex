import {randomBytes,sign} from "node:crypto";
import {z} from "zod";
import type {TeamPaymentSnapshot} from "../../application/billing/team-payment-provider.port";
import type {LoggerPort} from "../../application/ports/logger.port";
import {BILLING_ACCOUNTING_GENERATION} from "../../domain/billing/billing-generation";
import {TEAM_PAYMENT_PRODUCT} from "../../domain/billing/team-payment-product";
import type {DeploymentBillingConfig} from "./deployment-billing-config";
import {boundedBody,WechatNativeClient} from "./wechat-native-client";
import {verifyWechatSignature} from "./wechat-signature";
export type TeamWechatPaymentState={state:"pending"|"closed"}|{state:"paid";paymentRef:string;paidAt:Date;amountMinor:number;currency:string};
/** Provider authority only; no quote selection or wallet/Plan writes. */
export class TeamWechatPaymentClient{
 private readonly native:WechatNativeClient;
 constructor(private readonly config:DeploymentBillingConfig,logger:LoggerPort){this.native=new WechatNativeClient(config,logger);}
 async read(p:TeamPaymentSnapshot):Promise<TeamWechatPaymentState>{
  const config=this.config.getWechat();
  if(!config||p.quote.provider!=="wechat"||p.quote.currency!=="CNY"||p.quote.generation!==BILLING_ACCOUNTING_GENERATION||!/^[A-Za-z0-9_|*-]{6,32}$/.test(p.purchaseRef))throw Error("team_wechat_purchase_invalid");
  const path=`/v3/pay/transactions/out-trade-no/${encodeURIComponent(p.purchaseRef)}?mchid=${encodeURIComponent(config.mchId)}`;
  const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(16).toString("hex");
  const signature=sign("RSA-SHA256",Buffer.from(`GET\n${path}\n${timestamp}\n${nonce}\n\n`),config.privateKey).toString("base64");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(`https://api.mch.weixin.qq.com${path}`,{redirect:"error",signal:controller.signal,headers:{Accept:"application/json",...(config.platformKeyId?{"Wechatpay-Serial":config.platformKeyId}:{}),Authorization:`WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.mchSerialNo}",signature="${signature}"`}});
   const raw=await boundedBody(response,controller.signal);
   if(!config.platformKey||!verifyWechatSignature(config,name=>response.headers.get(name),raw))throw Error("team_wechat_query_signature_invalid");
   const data:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
   if(!data||typeof data!=="object"||Array.isArray(data))throw Error("team_wechat_query_invalid");
   const r=data as Record<string,unknown>;
   if(response.status===404&&r.code==="ORDER_NOT_EXIST")return {state:Date.now()>=p.checkoutExpiresAt.getTime()?"closed":"pending"};
   if(!response.ok||r.appid!==config.appId||r.mchid!==config.mchId||r.out_trade_no!==p.purchaseRef)throw Error("team_wechat_payment_mismatch");
   if(r.trade_state==="SUCCESS"){
    const amount=r.amount as Record<string,unknown>|undefined;
    if(typeof amount?.total!=="number"||!Number.isSafeInteger(amount.total)||amount.total<=0||typeof amount.currency!=="string"||!/^[A-Z]{3}$/.test(amount.currency)||r.attach!==`${TEAM_PAYMENT_PRODUCT}:${p.quote.generation}:${p.purchaseRef}`||typeof r.transaction_id!=="string"||!/^[A-Za-z0-9_]{1,128}$/.test(r.transaction_id))throw Error("team_wechat_payment_mismatch");
    const paidAt=new Date(z.string().datetime({offset:true}).parse(r.success_time));
    if(paidAt.getTime()<Math.floor(p.createdAt.getTime()/1000)*1000||paidAt.getTime()>Date.now())throw Error("team_wechat_payment_time_invalid");
    return {state:"paid",paymentRef:`wx_${r.transaction_id}`,paidAt,amountMinor:amount.total as number,currency:amount.currency as string};
   }
   if(["CLOSED","REVOKED","PAYERROR"].includes(String(r.trade_state)))return {state:"closed"};
   if(["NOTPAY","USERPAYING"].includes(String(r.trade_state)))return {state:"pending"};
   throw Error("team_wechat_state_unavailable");
  }finally{clearTimeout(timer);}
 }
 async reconcile(p:TeamPaymentSnapshot){
  const state=await this.read(p);
  if(state.state!=="pending"||Date.now()<p.checkoutExpiresAt.getTime())return state;
  try{await this.native.closeNativeOrder(p.purchaseRef);}catch{/* Payment may have won. Only the next verified read determines closure. */}
  return this.read(p);
 }
}
