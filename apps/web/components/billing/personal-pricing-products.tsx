"use client";
import * as React from "react";
import { Check, CreditCard, Wallet } from "lucide-react";
import { WELCOME_CREDITS, WELCOME_CREDIT_VALIDITY_DAYS, type PricingCatalog, type PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { subscriptionEligibility } from "@repo/contracts/billing-subscription";
import type { z } from "zod";
import type { BillingProvider } from "@repo/contracts/billing-credits";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pricingMoney, pricingNumber as number } from "./personal-pricing-format";

/** Pure server-catalog selection. Only SKU and channel leave this component; no client-owned quote is submitted. */
export function PersonalPricingProducts({kind,catalog,entitlement:e,busy=false,onSelect,onClose}:{
 kind:"plans"|"credits";catalog:PricingCatalog;entitlement:PricingSubscriptionInfo;busy?:boolean;
 onSelect:(sku:string,provider:z.infer<typeof BillingProvider>)=>void;onClose:()=>void;
}) {
 const subscriptions=React.useMemo(()=>catalog.products.filter(p=>p.kind==="subscription"),[catalog.products]);
 const packs=React.useMemo(()=>catalog.products.filter(p=>p.kind==="credit_topup"),[catalog.products]);
 const initialCycle=subscriptions.some(p=>p.cycle==="month")?"month":"year";
 const [cycle,setCycle]=React.useState<"month"|"year">(initialCycle),[pack,setPack]=React.useState(packs[0]?.sku),[preferred,setPreferred]=React.useState<"wechat"|"stripe">("wechat");
 React.useEffect(()=>{setCycle(initialCycle);setPack(packs[0]?.sku);setPreferred("wechat");},[catalog.version,kind,initialCycle,packs]);
 const selected=kind==="plans"?subscriptions.find(p=>p.cycle===cycle):packs.find(p=>p.sku===pack);
 const providers=catalog.enabledProviders.filter(p=>selected?.currency==="CNY"||p==="stripe");
 const provider=providers.find(p=>p===preferred)??providers[0];
 const paidTerm=e.plan!==null&&e.currentPeriodEnd!==null&&Date.parse(e.currentPeriodEnd)>Date.now();
 const blocked=kind==="plans"&&(paidTerm||e.checkoutPending||e.paymentReviewRequired||!subscriptionEligibility(e.status).canCreateSubscription);
 const disabled=busy||!selected||!provider||blocked;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent data-testid="pricing-products-dialog" className="max-h-[90vh] max-w-2xl overflow-y-auto">
  <DialogHeader><DialogTitle>{kind==="plans"?"选择适合你的套餐":"购买 AI 额度"}</DialogTitle><DialogDescription>确认套餐和支付方式后继续付款，以支付确认结果为准。</DialogDescription></DialogHeader>
  <div className="space-y-5">
   {kind==="plans"&&<div className="flex gap-1 rounded-control bg-muted p-1" aria-label="付款周期">{(["month","year"]as const).map(value=><Button key={value} data-testid={`pricing-cycle-${value}`} disabled={busy||!subscriptions.some(p=>p.cycle===value)} variant={cycle===value?"outline":"ghost"} aria-pressed={cycle===value} className="h-auto min-w-0 flex-1 whitespace-normal py-2 text-12" onClick={()=>setCycle(value)}>{value==="month"?"月付":"年付"}</Button>)}</div>}
   {kind==="plans"&&selected?.kind==="subscription"&&<div className="space-y-3 rounded-card border border-primary p-5 ring-1 ring-primary"><span className="flex items-center justify-between text-16 font-semibold">Pro<Check className="h-4 w-4" aria-hidden="true"/></span><p><strong className="text-30 font-semibold tabular-nums">{pricingMoney(selected.currency,selected.amountMinor)}</strong><span className="text-12 text-muted-foreground"> / {cycle==="month"?"月":"年"}</span></p><p className="text-13">1 个核心成员 · 每月 {number(selected.monthlyCredits)} credit</p><p className="text-12 text-muted-foreground">适合个人持续使用 AI</p></div>}
   {kind==="credits"&&<div className="space-y-2">{packs.map(p=><Button key={p.sku} data-testid={`pricing-pack-${p.credits}`} variant="outline" aria-pressed={selected?.sku===p.sku} disabled={busy} onClick={()=>setPack(p.sku)} className={cn("h-auto w-full justify-between gap-3 p-4",selected?.sku===p.sku&&"border-primary ring-1 ring-primary")}><span className="flex items-center gap-3"><Wallet className="h-4 w-4" aria-hidden="true"/>{number(p.credits)} credit{selected?.sku===p.sku&&<Check className="h-4 w-4" aria-hidden="true"/>}</span><strong className="text-16">{pricingMoney(p.currency,p.amountMinor)}</strong></Button>)}<p className="text-12 text-muted-foreground">充值额度长期有效；订阅额度不足时可额外充值。</p></div>}
   {!selected&&<p role="status" className="text-13 text-muted-foreground">当前没有可购买的套餐，请稍后再试。</p>}
   <div className="space-y-2 border-t border-border pt-4"><p className="text-12 font-medium">支付方式</p><div className="flex flex-wrap gap-2">{providers.map(p=><Button key={p} data-testid={`pricing-provider-${p}`} variant={provider===p?"outline":"ghost"} aria-pressed={provider===p} disabled={busy} onClick={()=>setPreferred(p)}><CreditCard className="mr-2 h-4 w-4" aria-hidden="true"/>{p==="wechat"?"微信支付":"Stripe"}</Button>)}</div>
    {!providers.length&&<p role="status" className="text-12 text-muted-foreground">暂时无法购买，请稍后再试。</p>}
    <p data-testid="pricing-renewal-note" className="text-12 text-muted-foreground">{kind==="credits"?"一次性购买，不自动续费。":provider==="stripe"?"自动续费，可在订阅管理中取消下一期续费。":"一次性购买，到期后手动续费。"}{kind==="plans"&&" 每月按原购买日发放，当期未用额度到期清零。"}</p>
   </div>
   {blocked&&<p role="status" className="text-13 text-muted-foreground">请先处理原订阅付款或管理已有订阅，避免重复购买。</p>}
   <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-13 text-muted-foreground">本次支付<strong data-testid="pricing-total" className="ml-3 text-24 font-semibold text-background-foreground tabular-nums">{selected?pricingMoney(selected.currency,selected.amountMinor):"—"}</strong></span><Button data-testid="pricing-continue-checkout" variant="primary" disabled={Boolean(disabled)} onClick={()=>{if(!disabled&&selected&&provider)onSelect(selected.sku,provider);}}>{busy?"正在创建付款…":"继续付款"}</Button></div>
   {kind==="plans"&&<p className="text-12 text-muted-foreground">Free 为新用户提供一次性 {number(WELCOME_CREDITS)} credit，到账后 {WELCOME_CREDIT_VALIDITY_DAYS} 天到期。Community 免费开源自部署，自备服务器与模型。</p>}
  </div>
 </DialogContent></Dialog>;
}
