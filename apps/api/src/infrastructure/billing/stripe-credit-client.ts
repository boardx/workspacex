
import type {OrderDraft} from "../../application/billing/billing-order-service";
import type {DeploymentBillingConfig} from "./deployment-billing-config";
import {STRIPE_API_VERSION} from "./stripe-portal-client";
export class StripeCreditClient {
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
 async create(order:OrderDraft){
  const cfg=this.config.getStripe();if(!cfg?.returnUrl)throw Error("stripe_disabled");
  const success=new URL(cfg.returnUrl),cancel=new URL(cfg.returnUrl);success.searchParams.set("credit_order",order.orderNo);cancel.searchParams.set("credit_order",order.orderNo);
  const body=new URLSearchParams({mode:"payment","adaptive_pricing[enabled]":"false",client_reference_id:order.orderNo,"metadata[product]":"credit_topup_v1","metadata[order_ref]":order.orderNo,
   "line_items[0][quantity]":"1","line_items[0][price_data][currency]":"cny","line_items[0][price_data][unit_amount]":String(order.amountFen),
   "line_items[0][price_data][product_data][name]":"WorkspaceX Credits",success_url:success.toString(),cancel_url:cancel.toString(),locale:"auto","payment_method_types[0]":"card"});
  const value=this.validate(await this.request("checkout/sessions",body,`credit-topup:${order.orderNo}`));
  const meta=value.metadata as Record<string,unknown>|null;
  if(value.client_reference_id!==order.orderNo||value.amount_total!==order.amountFen||value.currency!=="cny"||meta?.product!=="credit_topup_v1"||meta.order_ref!==order.orderNo||!["open","complete","expired"].includes(String(value.status)))throw Error("invalid_checkout");
  return value;
 }
 async expire(id:string){
  if(!/^cs_[A-Za-z0-9_]+$/.test(id))throw Error("invalid_checkout_id");
  return this.validate(await this.request(`checkout/sessions/${id}/expire`,new URLSearchParams()));
 }
 async retrieve(id:string){
  if(!/^cs_[A-Za-z0-9_]+$/.test(id)||id.length>255)throw Error("invalid_checkout_id");
  const value=this.validate(await this.request(`checkout/sessions/${id}`));if(value.id!==id)throw Error("invalid_checkout_id");return value;
 }
}
