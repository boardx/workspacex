"use client";
import QRCode from "qrcode";
import {requirePaymentUrl,requireManagementUrl} from "./payment-url";
import * as React from "react";
import {billingSubscription} from "@repo/contracts";
import {ApiError,apiRequest} from "@/lib/api-client";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {navigateToStripe} from "./stripe-navigation";
type Info=ReturnType<typeof billingSubscription.operations.getSubscriptionInfo.out.parse>;
type Read={status:"loading"}|{status:"ready";data:Info;refreshing?:boolean;refreshError?:string}|{status:"error";message:string};
const POLL_LIMIT=6;
function trustedUrl(raw:unknown,management:boolean){
 const {url}=billingSubscription.SubscriptionLink.parse(raw);
 return management?requireManagementUrl(url):requirePaymentUrl(url,"stripe");
}
export function LiveSubscription({state,retry,stripeEnabled,wechatEnabled=false,sessionToken,onCreditGranted}:{state:Read;retry:()=>void;stripeEnabled:boolean;wechatEnabled?:boolean;userId:string;sessionToken:string;onCreditGranted?:()=>void}){
 const [selectedProvider,setProvider]=React.useState<"stripe"|"wechat">(wechatEnabled?"wechat":"stripe");
 const [qr,setQr]=React.useState<string|null>(null);
 const canvas=React.useRef<HTMLCanvasElement>(null);
 React.useEffect(()=>{if(qr&&canvas.current)void QRCode.toCanvas(canvas.current,qr,{width:240,margin:2}).catch(()=>setError("二维码暂时无法显示，请继续付款重试。"));},[qr]);
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState<string|null>(null),[polls,setPolls]=React.useState(0);
 const [returning,setReturning]=React.useState(()=>typeof window!=="undefined"&&["subscription_return","subscription_management_return"].some(key=>new URLSearchParams(window.location.search).has(key)));
 const request=React.useRef<AbortController|null>(null),observed=React.useRef<string|null>(null);
 const data=state.status==="ready"?state.data:null;
 const manual=data?.purchaseMode==="manual_monthly",eligibility=data?billingSubscription.subscriptionEligibility(data.status):null;
 const legacy=!!eligibility?.canManageSubscription&&!manual;
 const active=!!eligibility?.hasEffectivePro,pending=!!data?.checkoutPending;
 const provider=data?.checkoutPending && data.paymentProvider ? data.paymentProvider : (selectedProvider === "wechat" ? wechatEnabled : stripeEnabled) ? selectedProvider : wechatEnabled ? "wechat" : "stripe";
 const sawPending=React.useRef(false);
 React.useEffect(()=>{
  if(pending)sawPending.current=true;
  if(active||data?.paymentReviewRequired||sawPending.current&&!pending){setQr(null);sawPending.current=false;}
 },[active,pending,data?.paymentReviewRequired]);
 React.useEffect(()=>{if(!qr)return;const timer=window.setTimeout(()=>setQr(null),15*60*1000);return()=>window.clearTimeout(timer);},[qr]);
 const grant=data?.creditGrant,creditPending=active&&grant?.status==="pending";
 const managementReturn=typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("subscription_management_return");
 const waiting=!data?.paymentReviewRequired&&(pending||creditPending||returning&&(!active||managementReturn));
 const end=data?.currentPeriodEnd?new Date(data.currentPeriodEnd):null;
 const refresh=React.useCallback(()=>{setError(null);setPolls(0);retry();},[retry]);
 React.useEffect(()=>()=>request.current?.abort(),[]);
 React.useEffect(()=>{
  const period=(grant?.status==="granted"||grant?.status==="expired")&&grant.grant?`${grant.status}:${grant.grant.periodEnd}`:null;
  if(period&&observed.current!==period){observed.current=period;onCreditGranted?.();if(!managementReturn)setReturning(false);}
 },[grant,onCreditGranted,managementReturn]);
 React.useEffect(()=>{
  if(!waiting||state.status!=="ready"||state.refreshing||polls>=POLL_LIMIT)return;
  const timer=window.setTimeout(()=>{setPolls(n=>n+1);retry();},3000);return()=>window.clearTimeout(timer);
 },[waiting,state,polls,retry]);
 React.useEffect(()=>{
  let last=0;const focus=()=>{if(document.visibilityState==="hidden"||Date.now()-last<1000)return;last=Date.now();retry();};
  window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);
  return()=>{window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);};
 },[retry]);
 React.useEffect(()=>{
  if(!data?.currentPeriodEnd||!active)return;const expiresAt=Date.parse(data.currentPeriodEnd);if(!Number.isFinite(expiresAt))return;
  let timer:number;
  const schedule=()=>{const delay=expiresAt-Date.now();if(delay<=0){retry();return;}timer=window.setTimeout(delay>2_147_000_000?schedule:retry,Math.min(delay+100,2_147_000_000));};
  schedule();return()=>window.clearTimeout(timer);
 },[data?.currentPeriodEnd,active,retry]);

 async function open(){
  if(request.current||busy||!data||state.status!=="ready"||state.refreshing)return;
  const operation=legacy?billingSubscription.operations.getManagementLink:billingSubscription.operations.getUpgradeLink;
  const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  let timedOut=false;const timer=window.setTimeout(()=>{timedOut=true;controller.abort();},20000);
  try{
   const raw=await apiRequest<unknown>(operation.path,{method:operation.method,...(!legacy?{body:{provider}}:{}),sessionToken,signal:controller.signal});
   if(controller.signal.aborted)return;let url:string;
   if(!legacy&&provider==="wechat"){
    url=requirePaymentUrl(billingSubscription.SubscriptionLink.parse(raw).url,"wechat");
    setQr(url);
   }else{url=trustedUrl(raw,legacy);navigateToStripe(url);}
   setReturning(true);setPolls(0);retry();
  }catch(failure){
   if(controller.signal.aborted&&!timedOut)return;
   setError(failure instanceof ApiError&&failure.reasonCode==="already_subscribed"?"正在更新套餐状态。":"暂时无法打开付款页面，请重试。");retry();
  }finally{window.clearTimeout(timer);request.current=null;if(!controller.signal.aborted||timedOut)setBusy(false);}
 }
 const notice=(data?.paymentReviewRequired?"付款需要人工核对，请联系客服，勿重复付款。":null)||error||(state.status==="error"?"暂时无法查询套餐，请重试。":state.status==="ready"?state.refreshError:null)||
  (waiting?(polls<POLL_LIMIT?"正在确认付款，请稍候。":"付款尚未确认，可刷新状态或继续付款。"):null);
 const uncertain=state.status==="ready"&&!!state.refreshError;
 const canBuy=!!data&&!active&&!legacy&&(stripeEnabled||wechatEnabled)&&!uncertain&&!data.paymentReviewRequired;
 return <div className="space-y-5">
  {!legacy&&!active&&<div className="flex items-baseline gap-1"><span className="text-30 font-semibold tabular-nums">¥{billingSubscription.MONTHLY_PASS_AMOUNT_FEN/100}</span><span className="text-13 text-muted-foreground">/ 月</span></div>}
  {!legacy&&!active&&<p className="text-13">每期 {billingSubscription.MONTHLY_SUBSCRIPTION_CREDITS.toLocaleString("zh-CN")} credit</p>}
  {state.status==="loading"&&<p role="status" className="text-13 text-muted-foreground">正在查询套餐…</p>}
  {data&&!(state.status==="ready"&&state.refreshError)&&<div className="space-y-2">
   <Badge data-testid="billing-subscription-status" tone={active?"success":"neutral"}>{active?"Pro · 使用中":data.paymentReviewRequired?"待核对":pending?"待付款":manual&&end?"已到期":legacy?"非 Pro · 待处理":"非 Pro · 未开通"}</Badge>
   {grant?.grant&&(active&&grant.status==="granted"||grant.status==="expired")&&<div className="space-y-2">
    <p className="text-12 text-muted-foreground">本期剩余 credit</p>
    <p className="text-24 font-semibold tabular-nums">{grant.grant.remainingCredits.toLocaleString("zh-CN")} <span className="text-13 font-normal text-muted-foreground">/ {grant.grant.credits.toLocaleString("zh-CN")}</span></p>
    <div className="flex items-center gap-3"><progress aria-label="本期剩余 credit" aria-valuenow={Math.round(grant.grant.remainingCredits/grant.grant.credits*100)} value={grant.grant.remainingCredits} max={grant.grant.credits} className="h-2 w-full overflow-hidden rounded-full accent-primary"/><span className="text-12 tabular-nums text-muted-foreground">{Math.round(grant.grant.remainingCredits/grant.grant.credits*100)}%</span></div>
   </div>}
   {active&&(!grant||grant.status==="pending"||grant.status==="none")&&<p role="status" className="text-13 text-muted-foreground">额度发放中</p>}
   {end&&Number.isFinite(end.getTime())&&<p className="text-13 text-muted-foreground">{end.toLocaleDateString("zh-CN")} 到期</p>}
  </div>}
  {!legacy&&<p className="text-12 text-muted-foreground">到期手动续费<span className="mx-2" aria-hidden>·</span>当期 credit 到期清零</p>}
  {legacy&&<p className="text-12 text-muted-foreground">{data?.cancelAtPeriodEnd?"原订阅已停止续费，当前付费期继续有效。":"原订阅仍需在账单中管理续费。"}</p>}
  {canBuy&&stripeEnabled&&wechatEnabled&&<div role="radiogroup" aria-label="月度套餐支付渠道">{(["wechat","stripe"] as const).map(value=><label key={value}><input type="radio" name="monthly-provider" checked={provider===value} disabled={pending||busy} onChange={()=>setProvider(value)}/>{value==="wechat"?"微信支付":"Stripe"}</label>)}</div>}
  {qr&&!active&&<canvas ref={canvas} role="img" aria-label="月度套餐微信支付二维码"/>}
  <div className="flex flex-wrap items-center gap-3">
   {(canBuy||legacy)&&!uncertain&&<Button disabled={busy||state.status==="ready"&&!!state.refreshing} onClick={()=>void open()}>{busy?"正在打开…":legacy?"管理订阅":pending?"继续付款":manual&&end?"续费 ¥180":"购买月度套餐"}</Button>}
   <Button variant="ghost" size="sm" disabled={busy||state.status==="loading"||state.status==="ready"&&!!state.refreshing} onClick={refresh}>刷新状态</Button>
  </div>
  {notice&&<p data-testid={state.status==="error"||uncertain?"err-billing-subscription":undefined} role={error?"alert":"status"} className="text-13 text-muted-foreground">{notice}</p>}
  {!stripeEnabled&&!wechatEnabled&&!legacy&&state.status==="ready"&&!notice&&<p className="text-12 text-muted-foreground">套餐购买暂不可用，请稍后重试。</p>}
 </div>;
}
