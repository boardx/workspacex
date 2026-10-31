import {randomBytes,sign} from "node:crypto";
import {MONTHLY_PASS_AMOUNT_FEN,MONTHLY_PASS_PRODUCT,MONTHLY_SUBSCRIPTION_CREDITS} from "@repo/contracts/billing-subscription";
import {OrderNo} from "@repo/contracts/billing-credits";
import type {MonthlyCheckoutProvider,MonthlyOrder} from "../../application/billing/monthly-pass-service";
import type {DatabasePort} from "../../application/ports/database.port";
import type {LoggerPort} from "../../application/ports/logger.port";
import type {DeploymentBillingConfig} from "./deployment-billing-config";
import {boundedBody,WechatNativeClient} from "./wechat-native-client";
import {verifyWechatSignature} from "./wechat-signature";
import {assertBillingGlobalStatement} from "./billing-global-boundary";
import {MONTHLY_PASS_SQL as SQL} from "./monthly-pass-sql";

type Row={order_id:string;session_ref:string;created_at:Date;checkout_url:string|null};
/** Durable merchant order number is reserved before the first Native request. */
export class WechatMonthlyPassClient implements MonthlyCheckoutProvider {
 private readonly native:WechatNativeClient;
 constructor(private readonly config:DeploymentBillingConfig,private readonly db:DatabasePort,logger:LoggerPort){this.native=new WechatNativeClient(config,logger);}
 enabled(){return this.config.getPublicConfig().enabledProviders.includes("wechat");}
 liveMode(){return true;}
 async create(order:MonthlyOrder){
  if(!this.enabled()||!order.sessionRef)throw Error("wechat_disabled");
  const expiredAt=new Date(order.createdAt.getTime()+900000).toISOString();
  if(Date.parse(expiredAt)<=Date.now())throw Error("wechat_order_expired");
  const url=await this.native.createNativeOrder({orderNo:order.sessionRef,ownerType:"user",ownerId:order.userId,createdBy:order.userId,
   provider:"wechat",status:"PENDING",packageId:MONTHLY_PASS_PRODUCT,amountFen:MONTHLY_PASS_AMOUNT_FEN,baseCredits:MONTHLY_SUBSCRIPTION_CREDITS,bonusCredits:0,
   currency:"CNY",createdAt:order.createdAt.toISOString(),expiredAt,paidAt:null,notifyAt:null,closedAt:null,lastErrorCode:null});
  return {id:order.sessionRef,url,status:"open"};
 }
 private async query(id:string):Promise<Record<string,unknown>>{
  const config=this.config.getWechat();if(!config)throw Error("wechat_unavailable");
  const path=`/v3/pay/transactions/out-trade-no/${encodeURIComponent(id)}?mchid=${encodeURIComponent(config.mchId)}`;
  const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(16).toString("hex");
  const signature=sign("RSA-SHA256",Buffer.from(`GET\n${path}\n${timestamp}\n${nonce}\n\n`),config.privateKey).toString("base64");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(`https://api.mch.weixin.qq.com${path}`,{redirect:"error",signal:controller.signal,headers:{Accept:"application/json","Accept-Language":"zh-CN",
    ...(config.platformKeyId?{"Wechatpay-Serial":config.platformKeyId}:{}),Authorization:`WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.mchSerialNo}",signature="${signature}"`}});
   const raw=await boundedBody(response,controller.signal);
   if(config.platformKey&&!verifyWechatSignature(config,name=>response.headers.get(name),raw))throw Error("wechat_query_signature");
   const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
   if(!value||typeof value!=="object"||Array.isArray(value))throw Error("wechat_query_invalid");
   const result=value as Record<string,unknown>;
   if(response.status===404&&result.code==="ORDER_NOT_EXIST")return {trade_state:"NOT_CREATED"};
   if(!response.ok||result.appid!==config.appId||result.mchid!==config.mchId||result.out_trade_no!==id)throw Error("wechat_query_mismatch");
   return result;
  }finally{clearTimeout(timer);}
 }
 async retrieve(id:string){
  OrderNo.parse(id);
  assertBillingGlobalStatement(SQL.wechatOrder);
  const row=await this.db.withoutTenant(async s=>(await s.query<Row>(SQL.wechatOrder,[id])).rows[0]);
  if(!row)throw Error("monthly_order_unknown");
  let result=await this.query(id),state=result.trade_state;
  if(state==="NOTPAY"&&row.created_at.getTime()+900000<=Date.now()){
   try{await this.native.closeNativeOrder(id);}catch{/* A payment racing closure must be re-read, never assumed canceled. */}
   result=await this.query(id);state=result.trade_state;
  }
  const session:Record<string,unknown>={id,object:"checkout.session",mode:"payment",livemode:true,client_reference_id:row.order_id,
   metadata:{product:MONTHLY_PASS_PRODUCT,order_ref:row.order_id,provider:"wechat"},url:row.checkout_url};
  if(state==="SUCCESS"){
   const amount=result.amount as Record<string,unknown>|undefined;
   if(amount?.total!==MONTHLY_PASS_AMOUNT_FEN||amount.currency!=="CNY"||typeof result.transaction_id!=="string"||!/^[A-Za-z0-9_]+$/.test(result.transaction_id))throw Error("monthly_wechat_payment_mismatch");
   return {...session,status:"complete",payment_status:"paid",amount_total:amount.total,currency:"cny",payment_intent:`wx_${result.transaction_id}`};
  }
  if(["CLOSED","REVOKED","PAYERROR"].includes(String(state))||state==="NOT_CREATED"&&row.created_at.getTime()+900000<=Date.now())return {...session,status:"expired"};
  // Expiration of the local timer alone never proves that an upstream payable order is closed.
  if(!["NOTPAY","USERPAYING","NOT_CREATED"].includes(String(state)))throw Error("wechat_state_unavailable");
  return {...session,status:"open",payment_status:"unpaid"};
 }
}
