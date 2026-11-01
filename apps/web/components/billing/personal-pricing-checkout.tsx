"use client";
import * as React from "react";
import QRCode from "qrcode";
import { billingCredits } from "@repo/contracts";
import { operations as pricing, type PricingCatalog, type PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { ApiError, apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonalPricingProducts } from "./personal-pricing-products";
import { beginPersonalCheckout, bindPersonalCheckout, clearPersonalCheckout, loadPersonalCheckout, type PendingPersonalCheckout } from "./personal-checkout-state";
import { requirePaymentUrl } from "./payment-url";
import { pricingMoney } from "./personal-pricing-format";
type Order=ReturnType<typeof billingCredits.BillingOrder.parse>;
type Props={kind:"plans"|"credits";userId:string;sessionToken:string;catalog:PricingCatalog;entitlement:PricingSubscriptionInfo;onClose:()=>void;onPaid:()=>void;navigate?:(url:string)=>void};
const POLL_LIMIT=12,POLL_INTERVAL_MS=5000;
/** A key change unmounts every request/timer before another authenticated scope can display a payment. */
export function PersonalPricingCheckout(props:Props){return <ScopedCheckout key={JSON.stringify([props.userId,props.sessionToken])} {...props}/>;}
function ScopedCheckout({kind,userId,sessionToken,catalog,entitlement,onClose,onPaid,navigate=(url:string)=>window.location.assign(url)}:Props){
 const [loading,setLoading]=React.useState(true),[context,setContext]=React.useState<PendingPersonalCheckout|null>(null),[order,setOrder]=React.useState<Order|null>(null);
 const [creating,setCreating]=React.useState(false),[fatal,setFatal]=React.useState<string|null>(null),[message,setMessage]=React.useState<string|null>(null),[readError,setReadError]=React.useState(false),[qrError,setQrError]=React.useState(false),[qrVersion,setQrVersion]=React.useState(0),[now,setNow]=React.useState(Date.now);
 const mounted=React.useRef(false),busy=React.useRef(false),reading=React.useRef(false),completed=React.useRef(false),autoStripe=React.useRef(false),requests=React.useRef(new Set<AbortController>()),canvas=React.useRef<HTMLCanvasElement>(null),snapshot=React.useRef<Order|null>(null);
 React.useEffect(()=>{
  mounted.current=true;const controllers=requests.current;
  try{setContext(loadPersonalCheckout(localStorage,userId));}catch{setFatal("无法读取之前的付款，请刷新或联系支持，勿重复付款。");}setLoading(false);
  return()=>{mounted.current=false;for(const request of controllers)request.abort();controllers.clear();};
 },[userId]);
 const refresh=React.useCallback(async(pending:PendingPersonalCheckout)=>{
  if(!pending.result||reading.current||completed.current||!mounted.current)return;
  reading.current=true;const controller=new AbortController();requests.current.add(controller);
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const path=billingCredits.operations.getPaymentOrder.path.replace(":orderNo",encodeURIComponent(pending.result.purchaseRef));
   const {order:current}=billingCredits.operations.getPaymentOrder.out.parse(await apiRequest<unknown>(path,{sessionToken,signal:controller.signal}));
   if(current.ownerType!=="user"||current.ownerId!==userId||current.orderNo!==pending.result.purchaseRef||current.provider!==pending.request.provider||current.packageId!==pending.request.sku||(pending.result.url!==null&&current.qrCodeUrl!==pending.result.url)||(pending.result.expiresAt!==null&&current.expiredAt!==pending.result.expiresAt))throw Error("payment_scope_mismatch");
   if(current.qrCodeUrl!==null)requirePaymentUrl(current.qrCodeUrl,current.provider);
   const quoted=catalog.version===pending.request.catalogVersion?catalog.products.find(p=>p.sku===pending.request.sku):null;
   if(quoted&&(current.amountFen!==quoted.amountMinor||current.currency!==quoted.currency||current.baseCredits!==(quoted.kind==="subscription"?quoted.monthlyCredits:quoted.credits)||current.bonusCredits!==0))throw Error("payment_quote_mismatch");
   if(snapshot.current&&["amountFen","currency","baseCredits","bonusCredits","packageId","qrCodeUrl","expiredAt"].some(key=>{
    const previous=snapshot.current![key as keyof Order];return current[key as keyof Order]!==previous&&!((key==="qrCodeUrl"||key==="expiredAt")&&previous===null);
   }))throw Error("payment_snapshot_mismatch");
   if(!mounted.current||controller.signal.aborted)return;snapshot.current=current;setOrder(current);setReadError(false);setNow(Date.now());setQrVersion(version=>version+1);
   if(["SUCCESS","FAILED","CLOSED"].includes(current.status))autoStripe.current=false;
   if(current.status==="SUCCESS"){
    autoStripe.current=false;
    if(!completed.current){completed.current=true;try{clearPersonalCheckout(localStorage,userId,pending.request.idempotencyKey);}catch{setMessage("支付已确认，本地记录未能清理，请保留订单号。");}try{onPaid();}catch{/* A refresh callback cannot reverse verified payment. */}}
   }else if(current.status==="PENDING"&&current.provider==="stripe"&&autoStripe.current&&current.expiredAt!==null&&current.qrCodeUrl!==null&&Date.parse(current.expiredAt)>Date.now()){
    autoStripe.current=false;navigate(requirePaymentUrl(current.qrCodeUrl,"stripe"));
   }
  }catch{if(mounted.current){autoStripe.current=false;setReadError(true);}}
  finally{clearTimeout(timer);requests.current.delete(controller);reading.current=false;}
 },[userId,sessionToken,catalog,onPaid,navigate]);
 const refreshRef=React.useRef(refresh);refreshRef.current=refresh;
 React.useEffect(()=>{
  if(!context?.result)return;
  let polls=0;void refreshRef.current(context);
  const timer=setInterval(()=>{setNow(Date.now());if(completed.current||snapshot.current&&["SUCCESS","FAILED","CLOSED"].includes(snapshot.current.status)||polls>=POLL_LIMIT){clearInterval(timer);return;}polls++;void refreshRef.current(context);},POLL_INTERVAL_MS);
  return()=>clearInterval(timer);
 },[context]);
 React.useEffect(()=>{
  const expiresAt=context?.result?.expiresAt;if(!expiresAt)return;
  const delay=Date.parse(expiresAt)-Date.now();
  if(delay<=0){setNow(Date.now());return;}
  if(delay>2147483647)return;
  const timer=setTimeout(()=>setNow(Date.now()),delay+1);return()=>clearTimeout(timer);
 },[context]);
 const canPay=order?.status==="PENDING"&&!readError&&order.expiredAt!==null&&order.qrCodeUrl!==null&&Date.parse(order.expiredAt)>now;
 React.useEffect(()=>{
  setQrError(false);if(!canPay||order?.provider!=="wechat"||order.qrCodeUrl===null||!canvas.current)return;
  let alive=true;void QRCode.toCanvas(canvas.current,order.qrCodeUrl,{width:240,margin:2,errorCorrectionLevel:"M"}).catch(()=>{if(alive)setQrError(true);});return()=>{alive=false;};
 },[canPay,order?.provider,order?.qrCodeUrl,qrVersion]);
 const submit=async(pending:PendingPersonalCheckout)=>{
  if(busy.current)return;busy.current=true;setCreating(true);setMessage(null);
  const controller=new AbortController();requests.current.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const saved=loadPersonalCheckout(localStorage,userId);
   if(!saved||saved.request.idempotencyKey!==pending.request.idempotencyKey)throw Error("pending_purchase_conflict");
   if(saved.result){setContext(saved);return;}
   const response=await apiRequest<unknown>(pricing.createPersonalCheckout.path,{method:pricing.createPersonalCheckout.method,body:pending.request,sessionToken,signal:controller.signal});
   if(!mounted.current||controller.signal.aborted)return;
   const bound=bindPersonalCheckout(localStorage,userId,pending.request.idempotencyKey,response);autoStripe.current=bound.result?.url!=null;setContext(bound);
  }catch(error){
   if(!mounted.current)return;
   const noIntent=error instanceof ApiError&&["catalog_changed","product_unavailable","payment_provider_not_configured","already_subscribed"].includes(error.reasonCode??"");
   if(noIntent){try{clearPersonalCheckout(localStorage,userId,pending.request.idempotencyKey);setContext(null);setMessage("套餐或订阅状态已更新，请刷新账户后重新选择。");}catch{setFatal("无法确认原付款记录，请联系支持，勿重复付款。");}}
   else setMessage("暂时无法确认付款结果，请继续原付款或稍后刷新，勿重复购买。");
  }finally{clearTimeout(timer);requests.current.delete(controller);busy.current=false;if(mounted.current)setCreating(false);}
 };
 const select=(sku:string,provider:"wechat"|"stripe")=>{
  if(busy.current)return;
  try{
   const pending=beginPersonalCheckout(localStorage,userId,{sku,provider,catalogVersion:catalog.version,idempotencyKey:crypto.randomUUID()});setContext(pending);void submit(pending);
  }catch(error){
   if(error instanceof Error&&error.message==="pending_purchase_exists"){try{setContext(loadPersonalCheckout(localStorage,userId));setMessage("请先处理原付款，勿重复购买。");}catch{setFatal("无法读取之前的付款，请联系支持。");}}
   else setFatal("无法保存付款状态，请刷新或联系支持。尚未发起新付款。");
  }
 };
 if(!loading&&!fatal&&!context)return <PersonalPricingProducts kind={kind} catalog={catalog} entitlement={entitlement} message={message??undefined} onSelect={select} onClose={onClose}/>;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent data-testid="pricing-checkout-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto">
  <DialogHeader><DialogTitle>确认付款</DialogTitle><DialogDescription>关闭窗口会保留原订单。付款结果以服务端确认记录为准。</DialogDescription></DialogHeader>
  {loading?<p role="status">正在读取原付款…</p>:fatal?<p role="alert" className="text-13 text-destructive">{fatal}</p>:context&&<div className="space-y-4">
   {creating&&<p role="status">正在创建付款，请稍候…</p>}
   {message&&<p role="status" className="text-13 text-muted-foreground">{message}</p>}
   {!context.result&&!creating&&<Button data-testid="pricing-resume-payment" variant="primary" onClick={()=>void submit(context)}>继续原付款</Button>}
   {context.result&&<>
    <p className="break-all text-12 text-muted-foreground">订单号：{context.result.purchaseRef}</p>
    {order&&<p className="text-24 font-semibold tabular-nums">{pricingMoney(order.currency,order.amountFen)}</p>}
    {!order&&!readError&&<p role="status">正在核实付款状态…</p>}
    {readError&&<p data-testid="pricing-payment-read-error" role="status" className="text-13 text-muted-foreground">暂时无法确认付款状态，请稍后刷新，勿重复付款。</p>}
    {order?.status==="SUCCESS"?<div className="space-y-3"><p data-testid="pricing-checkout-success" role="status" className="rounded-control bg-success p-3 text-success-foreground">支付已确认，请查看账户额度。</p><Button data-testid="pricing-payment-done" variant="primary" onClick={onClose}>完成</Button></div>:order?.status==="FAILED"?<p role="alert" className="text-13 text-destructive">付款需要人工核实，请保留订单号并联系支持，勿重复付款。</p>:order?.status==="CLOSED"?<div className="space-y-3"><p role="status">订单已确认关闭。</p><Button onClick={()=>{try{clearPersonalCheckout(localStorage,userId,context.request.idempotencyKey);setContext(null);setOrder(null);snapshot.current=null;completed.current=false;setMessage(null);}catch{setFatal("无法清理原订单记录，请联系支持。");}}}>重新选择套餐</Button></div>:<>
     {canPay&&order?.provider==="wechat"&&<canvas hidden={qrError} data-testid="pricing-checkout-qr" ref={canvas} className="mx-auto" role="img" aria-label="微信支付二维码"/>}
     {qrError&&<p role="status" className="text-13 text-destructive">二维码暂时无法显示，请刷新付款状态后重试。</p>}
     {canPay&&order?.provider==="stripe"&&order.qrCodeUrl!==null&&<Button variant="primary" onClick={()=>navigate(requirePaymentUrl(order.qrCodeUrl!,"stripe"))}>前往 Stripe 付款</Button>}
     {order&&order.status==="PENDING"&&!canPay&&!readError&&<p role="status" className="text-13 text-muted-foreground">付款时间已过，正在核实最终结果，勿重复付款。</p>}
     {order?.status==="PROCESSING"&&<p role="status">付款正在处理，请稍后刷新。</p>}
    </>}
    {order?.status!=="SUCCESS"&&<Button data-testid="pricing-refresh-payment" variant="outline" onClick={()=>void refresh(context)}>刷新付款状态</Button>}
   </>}
  </div>}
 </DialogContent></Dialog>;
}
