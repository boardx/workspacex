"use client";
import { ArrowUpRight, Clock3, CreditCard, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PACK_CREDITS, numberLabel, previewMoney, previewPrices, type PricingCycle, type PricingRegion } from "./pricing-preview-data";
import type { PurchaseKind } from "./pricing-purchase-dialog";

export function PricingAccountPreview({ team, free, expired, region, cycle, onPurchase, onHistory }: {
  team: boolean; free: boolean; expired: boolean; region: PricingRegion; cycle: PricingCycle;
  onPurchase: (kind: PurchaseKind) => void; onHistory: (kind: "usage" | "subscription" | "management") => void;
}) {
  const remaining = expired ? 0 : team ? 64000 : free ? 1000 : 14600;
  const total = team ? 100000 : free ? 1000 : 20000;
  return <div className="grid items-start gap-5 md:grid-cols-2">
    <section data-testid="pricing-wallet" className="rounded-card border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-14 font-medium"><Wallet className="h-4 w-4" aria-hidden="true" />{team ? "团队充值额度" : "充值额度"}</div>
      <p className="mt-2 text-13 text-muted-foreground">按需补充，长期有效。</p><p className="mt-7 text-12 text-muted-foreground">剩余充值余额</p>
      <p className="mt-1 text-40 font-semibold tracking-tight tabular-nums">{free ? "0" : "8,600"}<span className="ml-2 text-13 font-normal text-muted-foreground">credit</span></p>
      <div className="mt-5 flex flex-wrap gap-2"><Button data-testid="pricing-buy-credits" variant="primary" onClick={() => onPurchase("credits")}>购买额度</Button><Button data-testid="pricing-view-usage" variant="outline" onClick={() => onHistory("usage")}>查看用量<ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Button></div>
      <div className="mt-7 border-t border-border pt-4"><p className="text-12 text-muted-foreground">充值包</p><div className="mt-2 space-y-2 text-13">{PACK_CREDITS.map((credits, index) => <div key={credits} className="flex justify-between gap-4"><span>{numberLabel(credits)} credit</span><span className="tabular-nums">{previewMoney(region, previewPrices(region).packs[index]!)}</span></div>)}</div></div>
    </section>
    <section data-testid="pricing-subscription" className="rounded-card border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-14 font-medium"><CreditCard className="h-4 w-4" aria-hidden="true" />{team ? "团队订阅" : "我的订阅"}</span><Badge tone={expired ? "warning" : "primary"}>{team ? "Team" : free ? "Free" : "Pro"} · {expired ? "已到期" : free ? "体验" : "使用中"}</Badge></div>
      <p className="mt-7 text-12 text-muted-foreground">{free ? "新用户一次性赠送" : "本期剩余订阅额度"}</p><p className="mt-1 text-30 font-semibold tabular-nums">{numberLabel(remaining)}<span className="ml-2 text-13 font-normal text-muted-foreground">/ {numberLabel(total)} credit</span></p>
      <div className="mt-3 flex items-center gap-3"><Progress value={remaining} max={total} label="订阅额度剩余" className="flex-1" /><span className="text-12 text-muted-foreground tabular-nums">{Math.round(remaining / total * 100)}%</span></div>
      <p className="mt-4 flex items-center gap-2 text-12 text-muted-foreground"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{free ? "赠送额度于 2026/12/01 到期（到账后 30 天）" : expired ? "订阅已于 2026/10/31 到期" : "本期额度于 2026/12/01 到期"}</p>
      {!free && !expired && <p className="mt-2 text-12 text-muted-foreground">订阅有效至 {cycle === "year" ? "2027/11/01" : "2026/12/01"}</p>}
      {team && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-control bg-muted p-3"><span className="flex items-center gap-2 text-13"><Users className="h-4 w-4" aria-hidden="true" />已用 4 / 已购 5 席</span><Button data-testid="pricing-add-seats" size="sm" variant="outline" disabled={expired} onClick={() => onPurchase("seats")}>增加席位</Button><p className="w-full text-12 text-muted-foreground">按已购席位收费，成员减少不自动减费。</p></div>}
      <p className="mt-5 text-12 leading-relaxed text-muted-foreground">{expired ? "团队已停止新 AI 请求。登录与资料查看不受影响。" : free ? "用完后可购买充值额度，或升级 Pro 获得每月额度。" : `${region === "us" ? "Stripe 自动续费" : "微信一次性购买，到期手动续费"}；${cycle === "year" ? "年付仍按购买日逐月发放。" : "按购买日每月发放。"}当期未用额度到期清零。`}</p>
      <div className="mt-4 flex flex-wrap gap-2"><Button data-testid="pricing-open-plans" variant={free || expired ? "primary" : "outline"} onClick={() => onPurchase("plans")}>{expired ? "续费团队" : free ? "升级套餐" : "查看套餐"}</Button>{region === "us" && !free && <Button data-testid="pricing-manage-subscription" variant="ghost" onClick={() => onHistory("management")}>管理自动续费</Button>}</div>
      <div className="mt-6 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="text-13 font-medium">订阅历史</h3><Button data-testid="pricing-subscription-history" size="sm" variant="ghost" onClick={() => onHistory("subscription")}>查看全部</Button></div>{free ? <p className="mt-3 text-12 text-muted-foreground">还没有订阅记录。</p> : <div data-testid="pricing-latest-subscription" className="mt-3 flex flex-wrap items-start justify-between gap-2 text-12"><div><p>{team ? "Team" : "Pro"} {cycle === "year" ? "年度" : "月度"}订阅</p><p className="mt-1 text-muted-foreground">{expired ? `${cycle === "year" ? "2025/10/31" : "2026/09/30"} — 2026/10/31` : `2026/11/01 — ${cycle === "year" ? "2027/11/01" : "2026/12/01"}`}</p></div><span>{previewMoney(region, previewPrices(region)[team ? "team" : "pro"][cycle])}</span></div>}</div>
    </section>
  </div>;
}
