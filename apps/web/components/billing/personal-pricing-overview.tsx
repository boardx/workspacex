"use client";
import * as React from "react";
import { billingCredits, billingSubscription } from "@repo/contracts";
import { operations as pricing, type PricingCatalog, type PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PersonalPricingWalletCard, PersonalPricingSubscriptionCard, type PersonalPricingWallet } from "./personal-pricing-account";
import { usePersonalPricingRead, type PricingReadState } from "./personal-pricing-read";
import { requireManagementUrl } from "./payment-url";
import { SubscriptionHistory } from "./subscription-history";
const walletQuery={ownerType:"user"};
const parseCatalog=(raw:unknown)=>pricing.getPricingCatalog.out.parse(raw);
const parseEntitlement=(raw:unknown)=>pricing.getPricingEntitlement.out.parse(raw);
function parseWallet(raw:unknown,userId:string):PersonalPricingWallet {
 const {wallet}=billingCredits.operations.getWallet.out.parse(raw);
 if(wallet.ownerType!=="user"||wallet.ownerId!==userId||wallet.permanentBalance===undefined)throw Error("personal_wallet_facts_unavailable");
 return {...wallet,permanentBalance:wallet.permanentBalance};
}
function ReadNotice({state,name,label,retry}:{state:PricingReadState<unknown>;name:string;label:string;retry:()=>void}) {
 if(state.status==="ready"&&!state.refreshError)return null;
 if(state.status==="loading")return <div role="status" aria-label={`正在查询${label}`} className="h-24 animate-pulse rounded-card bg-muted"/>;
 return <div data-testid={`pricing-${name}-error`} className="space-y-3 rounded-card border border-border p-5"><p role="status" className="text-13 text-muted-foreground">{state.status==="ready"?`暂时无法刷新${label}，显示上次查询结果。`:`暂时无法查询${label}，请重试。`}</p><Button variant="outline" size="sm" onClick={retry}>重试{label}</Button></div>;
}
export function PersonalPricingOverview({userId,sessionToken,onPurchase,navigate=(url:string)=>window.location.assign(url)}:{
 userId:string;sessionToken:string;onPurchase:(kind:"plans"|"credits",catalog:PricingCatalog,entitlement:PricingSubscriptionInfo)=>void;navigate?:(url:string)=>void;
}) {
 const catalog=usePersonalPricingRead(pricing.getPricingCatalog.path,parseCatalog,userId,sessionToken);
 const wallet=usePersonalPricingRead(billingCredits.operations.getWallet.path,parseWallet,userId,sessionToken,walletQuery);
 const entitlement=usePersonalPricingRead(pricing.getPricingEntitlement.path,parseEntitlement,userId,sessionToken);
 const [message,setMessage]=React.useState<string|null>(null),[managementPending,setManagementPending]=React.useState(false);
 const busy=React.useRef(false),managementAbort=React.useRef<AbortController|null>(null),scope=`${userId}\0${sessionToken}`,latestScope=React.useRef(scope);latestScope.current=scope;
 React.useEffect(()=>{setMessage(null);setManagementPending(false);busy.current=false;return()=>managementAbort.current?.abort();},[scope]);
 const purchase=(kind:"plans"|"credits")=>{
  if(catalog.state.status!=="ready"||entitlement.state.status!=="ready"){setMessage("请先刷新套餐与订阅信息，再继续购买。");return;}
  onPurchase(kind,catalog.state.data,entitlement.state.data);
 };
 const manage=async()=>{
  if(busy.current)return;busy.current=true;setManagementPending(true);setMessage(null);
  const controller=new AbortController();managementAbort.current=controller;const timer=setTimeout(()=>controller.abort(),15000);
  try {
   const link=billingSubscription.operations.getManagementLink.out.parse(await apiRequest<unknown>(billingSubscription.operations.getManagementLink.path,{sessionToken,signal:controller.signal}));
   const url=requireManagementUrl(link.url);
   if(!controller.signal.aborted&&latestScope.current===scope)navigate(url);
  }catch{if(latestScope.current===scope)setMessage("暂时无法打开订阅管理，请重试。已有权益不会因此改变。");}
  finally{clearTimeout(timer);if(latestScope.current===scope){busy.current=false;setManagementPending(false);}}
 };
 return <div data-testid="personal-pricing-overview" className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-24 font-semibold">额度与订阅</h1><p className="mt-2 text-13 text-muted-foreground">按需充值，或选择适合你的订阅套餐。</p></div><Button variant="outline" size="sm" onClick={()=>{catalog.retry();wallet.retry();entitlement.retry();}}>刷新账户</Button></header>
  {message&&<p role="status" className="text-13 text-muted-foreground">{message}</p>}
  <ReadNotice state={catalog.state} name="catalog" label="套餐" retry={catalog.retry}/>
  <div className="grid items-start gap-5 md:grid-cols-2">
   <div className="space-y-3"><ReadNotice state={wallet.state} name="wallet" label="充值额度" retry={wallet.retry}/>{wallet.state.status==="ready"&&<PersonalPricingWalletCard wallet={wallet.state.data} catalog={catalog.state.status==="ready"?catalog.state.data:null} onPurchase={purchase}/>}</div>
   <div className="space-y-3"><ReadNotice state={entitlement.state} name="entitlement" label="订阅" retry={entitlement.retry}/>{entitlement.state.status==="ready"&&<PersonalPricingSubscriptionCard entitlement={entitlement.state.data} onPurchase={purchase} onManage={()=>void manage()} managementPending={managementPending} history={<SubscriptionHistory key={scope} sessionToken={sessionToken}/>}/>}</div>
  </div>
 </div>;
}
