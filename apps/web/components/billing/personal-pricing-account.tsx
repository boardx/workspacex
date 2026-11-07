"use client";
import type * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, CreditCard, Wallet } from "lucide-react";
import type { z } from "zod";
import type { CreditWallet } from "@repo/contracts/billing-credits";
import type { PricingCatalog, PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { subscriptionEligibility } from "@repo/contracts/billing-subscription";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { pricingDate, pricingMoney, pricingNumber as number } from "./personal-pricing-format";

export type PersonalPricingWallet = z.infer<typeof CreditWallet> & { permanentBalance: number };
type Purchase = (kind: "plans" | "credits") => void;
export function PersonalPricingWalletCard({wallet,catalog,onPurchase}:{wallet:PersonalPricingWallet;catalog:PricingCatalog|null;onPurchase:Purchase}) {
  const packs = catalog?.products.filter(p => p.kind === "credit_topup") ?? [];
  return (
    <section data-testid="pricing-wallet" className="rounded-card border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-14 font-medium"><Wallet className="h-4 w-4" aria-hidden="true" />充值额度</div>
      <p className="mt-2 text-13 text-muted-foreground">按需补充，长期有效。</p>
      <p className="mt-7 text-12 text-muted-foreground">剩余充值余额</p>
      <p data-testid="pricing-wallet-balance" className="mt-1 text-40 font-semibold tracking-tight tabular-nums">{number(wallet.permanentBalance)}<span className="ml-2 text-13 font-normal text-muted-foreground">credit</span></p>
      {wallet.balance < 0 && <p role="status" className="mt-3 text-13 text-destructive">待结算欠额 {number(Math.abs(wallet.balance))} credit，充值后可发起新请求；已开始的请求可以完成。</p>}
      <div className="mt-5 flex flex-wrap gap-2"><Button data-testid="pricing-buy-credits" variant="primary" disabled={!catalog?.enabledProviders.length} onClick={() => onPurchase("credits")}>购买额度</Button><Button asChild variant="outline"><Link href="/usage">查看用量<ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link></Button></div>
      {!catalog?.enabledProviders.length && <p className="mt-3 text-12 text-muted-foreground">暂时无法购买，已有额度和资料仍可查看。</p>}
      <div className="mt-7 border-t border-border pt-4"><p className="text-12 text-muted-foreground">充值包</p><div className="mt-2 space-y-2 text-13">{packs.map(p => <div key={p.sku} className="flex justify-between gap-4"><span>{number(p.credits)} credit</span><span className="tabular-nums">{pricingMoney(p.currency, p.amountMinor)}</span></div>)}</div></div>
    </section>
  );
}
export function PersonalPricingSubscriptionCard({entitlement:e,onPurchase,onManage,managementPending=false,history}:{
  entitlement:PricingSubscriptionInfo;onPurchase:Purchase;onManage:()=>void;managementPending?:boolean;history?:React.ReactNode;
}) {
  const paid = e.plan === "pro", expired = paid && Date.parse(e.currentPeriodEnd!) <= Date.now();
  const gift = e.welcomeCreditGrant, quota = paid ? e.creditGrant?.grant : gift.grant;
  const grantExpired = paid ? e.creditGrant?.status === "expired" : gift.status === "expired";
  const quotaEnd = paid ? e.creditGrant?.grant?.periodEnd : gift.grant?.expiresAt;
  const canManage = e.paymentProvider === "stripe" && subscriptionEligibility(e.status).canManageSubscription;
  const renewal = e.renewalMode === "automatic" ? e.cancelAtPeriodEnd || e.status === "canceled"
    ? "已取消下一期自动续费，当前付款期限内仍可使用。"
    : "Stripe 自动续费，可在订阅管理中取消下一期续费。"
    : "微信一次性购买，到期后手动续费。";
  return (
    <section data-testid="pricing-subscription" className="rounded-card border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-14 font-medium"><CreditCard className="h-4 w-4" aria-hidden="true" />我的订阅</span><Badge data-testid="pricing-plan-badge" tone={expired ? "warning" : "primary"}>{paid ? "Pro" : "Free"} · {expired ? "已到期" : paid ? "使用中" : "体验"}</Badge></div>
      <p className="mt-7 text-12 text-muted-foreground">{paid ? "本期剩余订阅额度" : gift.grant ? "新用户一次性赠送" : "尚无订阅"}</p>
      {quota ? <><p data-testid="pricing-quota" className="mt-1 text-30 font-semibold tabular-nums">{number(quota.remainingCredits)}<span className="ml-2 text-13 font-normal text-muted-foreground">/ {number(quota.credits)} credit</span></p>
        <div className="mt-3 flex items-center gap-3"><Progress value={quota.remainingCredits} max={quota.credits} label="额度剩余" className="flex-1" /><span className="text-12 text-muted-foreground tabular-nums">{Math.round(quota.remainingCredits / quota.credits * 100)}%</span></div>
        {quotaEnd && <p data-testid="pricing-quota-expiry" className="mt-4 flex items-center gap-2 text-12 text-muted-foreground"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{paid ? "本期额度" : "赠送额度"}{grantExpired ? "已于" : "于"} {pricingDate(quotaEnd)} 到期{!paid && "（到账后 30 天）"}</p>}</>
        : paid && <p role="status" className="mt-2 text-13 text-muted-foreground">正在等待本期额度到账，请稍后刷新。</p>}
      {paid && e.currentPeriodEnd && <p data-testid="pricing-payment-expiry" className="mt-2 text-12 text-muted-foreground">订阅{expired ? "已于" : "有效至"} {pricingDate(e.currentPeriodEnd)}{expired && " 到期"}</p>}
      {paid && gift.grant && <p className="mt-3 text-12 text-muted-foreground">新用户赠送还剩 {number(gift.grant.remainingCredits)} credit，{pricingDate(gift.grant.expiresAt)} 到期。</p>}
      {paid && <p data-testid="pricing-renewal-note" className="mt-5 text-12 leading-relaxed text-muted-foreground">{renewal}{e.billingCycle === "year" ? " 年付仍按原购买日逐月发放。" : " 按原购买日每月发放。"}当期未用额度到期清零。</p>}
      {!paid && <p className="mt-5 text-12 leading-relaxed text-muted-foreground">可购买充值额度，或升级 Pro 获得每月额度。</p>}
      {e.checkoutPending && <p role="status" className="mt-3 text-13 text-muted-foreground">有一笔订阅付款待确认，请继续原订单或稍后刷新。</p>}
      {e.paymentReviewRequired && <p role="alert" className="mt-3 text-13 text-destructive">付款需要人工核实，请联系支持并保留订单信息。</p>}
      {["past_due", "unpaid", "incomplete"].includes(e.status) && <p role="status" className="mt-3 text-13 text-muted-foreground">订阅付款待处理，请打开订阅管理查看。</p>}
      <div className="mt-4 flex flex-wrap gap-2"><Button data-testid="pricing-open-plans" variant={!paid || expired ? "primary" : "outline"} onClick={() => onPurchase("plans")}>{!paid ? "升级套餐" : expired ? "续费套餐" : "查看套餐"}</Button>{canManage && <Button data-testid="pricing-manage-subscription" variant="ghost" disabled={managementPending} onClick={onManage}>{managementPending ? "正在打开…" : "管理自动续费"}</Button>}</div>
      <div className="mt-6">{history}</div>
    </section>
  );
}
/** Adopted account layout; balances, payment terms and quota periods are server facts. */
export function PersonalPricingAccount(props:{wallet:PersonalPricingWallet;entitlement:PricingSubscriptionInfo;catalog:PricingCatalog;onPurchase:Purchase;onManage:()=>void;managementPending?:boolean;history?:React.ReactNode}) {
 return <div className="grid items-start gap-5 md:grid-cols-2"><PersonalPricingWalletCard {...props}/><PersonalPricingSubscriptionCard {...props}/></div>;
}
