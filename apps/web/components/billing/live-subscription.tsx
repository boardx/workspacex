"use client";
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
 const {url}=billingSubscription.SubscriptionLink.parse(raw),target=new URL(url);
 if(target.protocol!=="https:"||target.port||target.username||target.password||!(management?["billing.stripe.com"]:["checkout.stripe.com"]).includes(target.hostname))throw Error("invalid_destination");return url;
}
export function LiveSubscription({state,retry,stripeEnabled,sessionToken,onCreditGranted}:{state:Read;retry:()=>void;stripeEnabled:boolean;userId:string;sessionToken:string;onCreditGranted?:()=>void}){
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState<string|null>(null),[polls,setPolls]=React.useState(0);
 const [returning,setReturning]=React.useState(()=>typeof window!=="undefined"&&["subscription_return","subscription_management_return"].some(key=>new URLSearchParams(window.location.search).has(key)));
 const request=React.useRef<AbortController|null>(null),observed=React.useRef<string|null>(null);
 const data=state.status==="ready"?state.data:null;
 const manual=data?.purchaseMode==="manual_monthly",eligibility=data?billingSubscription.subscriptionEligibility(data.status):null;
 const legacy=!!eligibility?.canManageSubscription&&!manual;
 const active=!!eligibility?.hasEffectivePro,pending=!!data?.checkoutPending;
 const grant=data?.creditGrant,creditPending=active&&grant?.status==="pending";
 const managementReturn=typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("subscription_management_return");
 const waiting=pending||creditPending||returning&&(!active||managementReturn);
 const end=data?.currentPeriodEnd?new Date(data.currentPeriodEnd):null;
 const refresh=React.useCallback(()=>{setError(null);setPolls(0);retry();},[retry]);
 React.useEffect(()=>()=>request.current?.abort(),[]);
 React.useEffect(()=>{
  const period=(grant?.status==="granted"||grant?.status==="expired")&&grant.grant?`${grant.status}:${grant.grant.periodEnd}`:null;
  if(period&&observed.current!==period){observed.current=period;onCreditGranted?.();setReturning(false);}
 },[grant,onCreditGranted]);
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
  if(!data?.currentPeriodEnd||!active)return;const delay=Date.parse(data.currentPeriodEnd)-Date.now();if(!Number.isFinite(delay)||delay<=0)return;
  const timer=window.setTimeout(retry,Math.min(delay+100,2_147_000_000));return()=>window.clearTimeout(timer);
 },[data?.currentPeriodEnd,active,retry]); // Refresh an open page when its paid period ends.
 async function open(){
  if(request.current||busy||!data||state.status!=="ready"||state.refreshing)return;
  const operation=legacy?billingSubscription.operations.getManagementLink:billingSubscription.operations.getUpgradeLink;
  const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  let timedOut=false;const timer=window.setTimeout(()=>{timedOut=true;controller.abort();},20000);
  try{
   const raw=await apiRequest<unknown>(operation.path,{method:operation.method,...(!legacy?{body:{}}:{}),sessionToken,signal:controller.signal});
   if(controller.signal.aborted)return;const url=trustedUrl(raw,legacy);setReturning(true);setPolls(0);navigateToStripe(url);
  }catch(failure){
   if(controller.signal.aborted&&!timedOut)return;
   setError(failure instanceof ApiError&&failure.reasonCode==="already_subscribed"?"正在更新套餐状态。":"暂时无法打开付款页面，请重试。");retry();
  }finally{window.clearTimeout(timer);request.current=null;if(!controller.signal.aborted||timedOut)setBusy(false);}
 }
 const notice=error||(state.status==="error"?"暂时无法查询套餐，请重试。":state.status==="ready"?state.refreshError:null)||
  (waiting?(polls<POLL_LIMIT?"正在确认付款，请稍候。":"付款尚未确认，可刷新状态或继续付款。"):null);
 const uncertain=state.status==="ready"&&!!state.refreshError;
 const canBuy=!!data&&!active&&!legacy&&stripeEnabled&&!uncertain;
 return <div className="space-y-5">
  {!legacy&&<div className="flex items-baseline gap-1"><span className="text-30 font-semibold tabular-nums">¥{billingSubscription.MONTHLY_PASS_AMOUNT_FEN/100}</span><span className="text-13 text-muted-foreground">/ 月</span></div>}
  {!legacy&&<p className="text-13">每期 {billingSubscription.MONTHLY_SUBSCRIPTION_CREDITS.toLocaleString("zh-CN")} credit</p>}
  {state.status==="loading"&&<p role="status" className="text-13 text-muted-foreground">正在查询套餐…</p>}
  {data&&!(state.status==="ready"&&state.refreshError)&&<div className="space-y-2">
   <Badge data-testid="billing-subscription-status" tone={active?"success":"neutral"}>{active?"使用中":pending?"待付款":manual&&end?"已到期":legacy?"待处理":"未开通"}</Badge>
   {active&&grant?.status==="granted"&&<p className="text-16 font-medium tabular-nums">{grant.grant!.remainingCredits.toLocaleString("zh-CN")} / {billingSubscription.MONTHLY_SUBSCRIPTION_CREDITS.toLocaleString("zh-CN")} credit</p>}
   {end&&Number.isFinite(end.getTime())&&<p className="text-13 text-muted-foreground">{end.toLocaleDateString("zh-CN")} 到期</p>}
  </div>}
  {!legacy&&<p className="text-12 text-muted-foreground">到期手动续费<span className="mx-2" aria-hidden>·</span>当期 credit 到期清零</p>}
  {legacy&&<p className="text-12 text-muted-foreground">{data?.cancelAtPeriodEnd?"原订阅已停止续费，当前付费期继续有效。":"原订阅仍需在账单中管理续费。"}</p>}
  <div className="flex flex-wrap items-center gap-3">
   {(canBuy||legacy)&&!uncertain&&<Button disabled={busy||state.status==="ready"&&!!state.refreshing} onClick={()=>void open()}>{busy?"正在打开…":legacy?"管理订阅":pending?"继续付款":manual&&end?"续费 ¥180":"购买月度套餐"}</Button>}
   <Button variant="ghost" size="sm" disabled={busy||state.status==="loading"||state.status==="ready"&&!!state.refreshing} onClick={refresh}>刷新状态</Button>
  </div>
  {notice&&<p data-testid={state.status==="error"||uncertain?"err-billing-subscription":undefined} role={error?"alert":"status"} className="text-13 text-muted-foreground">{notice}</p>}
  {!stripeEnabled&&!legacy&&state.status==="ready"&&!notice&&<p className="text-12 text-muted-foreground">套餐购买暂不可用，请稍后重试。</p>}
 </div>;
}
