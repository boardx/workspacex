import {MONTHLY_PASS_AMOUNT_FEN,MONTHLY_PASS_PRODUCT} from "@repo/contracts/billing-subscription";
import type {MonthlyCheckoutProvider,MonthlyOrder} from "../../application/billing/monthly-pass-service";
import type {DeploymentBillingConfig} from "./deployment-billing-config";
import {STRIPE_API_VERSION} from "./stripe-portal-client";
export class StripeMonthlyPassClient implements MonthlyCheckoutProvider {
 constructor(private readonly config:DeploymentBillingConfig){}
 enabled(){return this.config.getPublicConfig().enabledProviders.includes("stripe")&&!!this.config.getStripe()?.returnUrl;}
 liveMode(){return this.config.getStripe()?.secretKey.startsWith("sk_live_")===true;}
 private async request(path:string,body?:URLSearchParams,key?:string):Promise<Record<string,unknown>>{
  const cfg=this.config.getStripe();if(!cfg)throw Error("stripe_disabled");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancel=()=>{void reader?.cancel().catch(()=>undefined);};controller.signal.addEventListener("abort",cancel,{once:true});
  try{
   const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:body?"POST":"GET",redirect:"error",signal:controller.signal,
    headers:{Authorization:`Bearer ${cfg.secretKey}`,"Stripe-Version":STRIPE_API_VERSION,...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(key?{"Idempotency-Key":key}:{})},...(body?{body:body.toString()}:{})});
   if(!response.ok||!response.body){void response.body?.cancel().catch(()=>undefined);throw Error("stripe_checkout_unavailable");}
   reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
   while(true){if(controller.signal.aborted)throw Error("deadline");const next=await reader.read();if(controller.signal.aborted)throw Error("deadline");if(next.done)break;bytes+=next.value.byteLength;if(bytes>65536)throw Error("response_too_large");chunks.push(next.value);}
   const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
   if(!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid_checkout");return value as Record<string,unknown>;
  }finally{clearTimeout(timer);controller.signal.removeEventListener("abort",cancel);cancel();}
 }
 private validate(value:Record<string,unknown>){
  if(value.object!=="checkout.session"||value.mode!=="payment"||value.livemode!==this.liveMode()||typeof value.id!=="string"||!/^cs_[A-Za-z0-9_]+$/.test(value.id))throw Error("invalid_checkout");
  if(value.url!=null){const url=new URL(String(value.url));if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com"||url.port||url.username||url.password)throw Error("untrusted_checkout_url");}
  return value;
 }
 async create(order:MonthlyOrder){
  const cfg=this.config.getStripe();if(!this.enabled()||!cfg?.returnUrl)throw Error("stripe_disabled");
  const success=new URL(cfg.returnUrl),cancel=new URL(cfg.returnUrl);success.searchParams.set("subscription_return","1");cancel.searchParams.set("subscription_return","1");
  const body=new URLSearchParams({mode:"payment","adaptive_pricing[enabled]":"false",client_reference_id:order.orderId,"metadata[product]":MONTHLY_PASS_PRODUCT,"metadata[order_ref]":order.orderId,
   "line_items[0][quantity]":"1","line_items[0][price_data][currency]":"cny","line_items[0][price_data][unit_amount]":String(MONTHLY_PASS_AMOUNT_FEN),
   "line_items[0][price_data][product_data][name]":"WorkspaceX 月度套餐",success_url:success.toString(),cancel_url:cancel.toString(),locale:"auto","payment_method_types[0]":"card"});
  const value=this.validate(await this.request("checkout/sessions",body,`monthly-pass:${order.orderId}`));
  const meta=value.metadata as Record<string,unknown>|null;
  if(value.client_reference_id!==order.orderId||value.amount_total!==MONTHLY_PASS_AMOUNT_FEN||value.currency!=="cny"||meta?.product!==MONTHLY_PASS_PRODUCT||meta.order_ref!==order.orderId||!["open","complete","expired"].includes(String(value.status)))throw Error("invalid_checkout");
  return value;
 }
 async retrieve(id:string){
  if(!/^cs_[A-Za-z0-9_]+$/.test(id)||id.length>255)throw Error("invalid_checkout_id");
  const value=this.validate(await this.request(`checkout/sessions/${id}`));if(value.id!==id)throw Error("invalid_checkout_id");return value;
 }
}
