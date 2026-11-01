"use client";
import * as React from "react";
import { Check, CreditCard, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PACK_CREDITS, numberLabel, previewMoney, previewPrices, type PricingCycle, type PricingRegion } from "./pricing-preview-data";

export type PurchaseKind = "plans" | "credits" | "seats";
export function PricingPurchaseDialog({ kind, region, cycle, team = false, onCycleChange, onClose, onPurchased }: {
  kind: PurchaseKind | null; region: PricingRegion; cycle: PricingCycle; onCycleChange: (cycle: PricingCycle) => void;
  team?: boolean;
  onClose: () => void; onPurchased: (message: string) => void;
}) {
  const [plan, setPlan] = React.useState<"pro" | "team">("pro");
  const [pack, setPack] = React.useState(0);
  const [seats, setSeats] = React.useState(1);
  const [provider, setProvider] = React.useState<"wechat" | "stripe">("wechat");
  const [confirmed, setConfirmed] = React.useState(false);
  React.useEffect(() => { setConfirmed(false); setProvider(region === "us" ? "stripe" : "wechat"); setPlan(team ? "team" : "pro"); }, [kind, region, team]);
  const p = previewPrices(region);
  const amount = kind === "credits" ? p.packs[pack]! : kind === "seats" ? Math.ceil(p.seat[cycle] * seats * 0.5 * 100) / 100 : p[plan][cycle];
  const title = kind === "credits" ? "购买 AI 额度" : kind === "seats" ? "增加团队席位" : "选择适合你的套餐";
  return <Dialog open={kind !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent data-testid="pricing-purchase-dialog" className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>设计预览 · 不会发起真实支付</DialogDescription></DialogHeader>
      {confirmed ? <div data-testid="pricing-payment-result" className="space-y-4 py-6 text-center">
        <Check className="mx-auto h-8 w-8 text-success" aria-hidden="true" /><h3 className="text-18 font-semibold">已演示购买成功</h3>
        <p className="text-13 text-muted-foreground">实际开通将以支付确认结果为准。</p>
        <Button data-testid="pricing-payment-done" onClick={onClose}>完成</Button>
      </div> : <div className="space-y-5">
        {kind === "plans" && <div className="flex gap-1 rounded-control bg-muted p-1" aria-label="付款周期">
          {(["month", "year"] as const).map(value => <Button key={value} data-testid={`pricing-cycle-${value}`} variant={cycle === value ? "outline" : "ghost"} className="h-auto min-w-0 flex-1 whitespace-normal py-2 text-12" aria-pressed={cycle === value} onClick={() => onCycleChange(value)}>{value === "month" ? "月付" : "年付 · 付 10 个月享 1 年"}</Button>)}
        </div>}
        {kind === "plans" && <div className="grid gap-3 sm:grid-cols-2">
          {(team ? ["team"] as const : ["pro", "team"] as const).map(key => <Button key={key} data-testid={`pricing-plan-${key}`} variant="outline" aria-pressed={plan === key} onClick={() => setPlan(key)} className={cn("h-auto min-w-0 flex-col items-start gap-3 whitespace-normal p-5 text-left", plan === key && "border-primary ring-1 ring-primary")}>
            <span className="flex w-full items-center justify-between text-16 font-semibold">{key === "pro" ? "Pro" : "Team"}{plan === key && <Check className="h-4 w-4" aria-hidden="true" />}</span>
            <span><strong className="text-30 font-semibold tabular-nums">{previewMoney(region, p[key][cycle])}</strong><span className="text-12 text-muted-foreground"> / {cycle === "month" ? "月" : "年"}</span></span>
            <span className="text-13">{key === "pro" ? "1 个核心成员" : "5 个核心席位"}</span>
            <span className="text-13">每月 {key === "pro" ? "20,000" : "100,000 共享"} credit</span>
            <span className="text-12 text-muted-foreground">{key === "pro" ? "适合个人持续使用 AI" : "含团队管理，可付费增加席位"}</span>
          </Button>)}
        </div>}
        {kind === "plans" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-muted p-3 text-12"><span>Enterprise · 10 个核心成员起</span><span>{previewMoney(region, p.enterprise)}/年起 · 联系平台管理员开通</span></div>}
        {kind === "credits" && <div className="space-y-2">{PACK_CREDITS.map((credits, index) => <Button data-testid={`pricing-pack-${credits}`} key={credits} variant="outline" aria-pressed={pack === index} onClick={() => setPack(index)} className={cn("h-auto w-full justify-between p-4", pack === index && "border-primary ring-1 ring-primary")}>
          <span className="flex items-center gap-3"><Wallet className="h-4 w-4" aria-hidden="true" /><span>{numberLabel(credits)} credit</span>{pack === index && <Check className="h-4 w-4" aria-hidden="true" />}</span><strong className="text-16">{previewMoney(region, p.packs[index]!)}</strong>
        </Button>)}<p className="text-12 text-muted-foreground">充值额度长期有效；订阅额度不足时可额外充值。</p></div>}
        {kind === "seats" && <div className="space-y-4 rounded-card border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-13"><Users className="h-4 w-4" aria-hidden="true" />新增核心席位</span><div className="flex items-center gap-4">
            <Button data-testid="pricing-seat-minus" variant="outline" aria-label="减少本次增购席位" disabled={seats <= 1} onClick={() => setSeats(v => v - 1)}>−</Button>
            <span data-testid="pricing-seat-count" className="tabular-nums">{seats}</span><Button data-testid="pricing-seat-plus" variant="outline" aria-label="增加本次增购席位" disabled={seats >= 100} onClick={() => setSeats(v => v + 1)}>＋</Button>
          </div></div>
          <dl className="space-y-3 text-13"><div className="flex justify-between"><dt className="text-muted-foreground">标准单价</dt><dd>{previewMoney(region, p.seat[cycle])}/席/{cycle === "month" ? "月" : "年"}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">本次演示剩余有效期</dt><dd>50%</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">与团队订阅同时到期</dt><dd>{cycle === "year" ? "2027/11/01" : "2026/12/01"}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">后续完整月新增共享额度</dt><dd>{numberLabel(15000 * seats)} credit/月</dd></div></dl>
          <p className="text-12 text-muted-foreground">按剩余有效期补差价。首期新增额度按剩余月度周期折算；此处仅演示报价。</p>
        </div>}
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-12 font-medium">支付方式</p><div className="flex flex-wrap gap-2">{(region === "devapp" ? ["wechat", "stripe"] as const : [region === "us" ? "stripe" : "wechat"] as const).map(value => <Button data-testid={`pricing-provider-${value}`} key={value} variant={provider === value ? "outline" : "ghost"} aria-pressed={provider === value} onClick={() => setProvider(value)}><CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />{value === "wechat" ? "微信支付" : "Stripe"}</Button>)}{region === "devapp" && <Badge>测试环境</Badge>}</div>
          <p data-testid="pricing-renewal-note" className="text-12 text-muted-foreground">{kind === "credits" ? "一次性购买，不自动续费。" : provider === "wechat" ? "一次性购买，到期后手动续费。" : "自动续费，可在订阅管理中取消下一期续费。"}{kind !== "credits" && " 每月按购买日发放，当期未用额度到期清零。"}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-13 text-muted-foreground">{kind === "seats" ? "本次补差价" : "本次支付"}<strong data-testid="pricing-total" className="ml-3 text-24 font-semibold text-foreground tabular-nums">{previewMoney(region, amount)}</strong></span>
          <Button data-testid="pricing-pay-preview" variant="primary" onClick={() => { setConfirmed(true); onPurchased("购买成功演示已完成，尚未产生真实扣款或额度。"); }}>模拟确认支付</Button></div>
        {kind === "plans" && <p className="text-12 text-muted-foreground">Free 为新用户提供一次性 1,000 credit，到账后 30 天到期。Community 免费开源自部署，自备服务器与模型。</p>}
      </div>}
    </DialogContent>
  </Dialog>;
}
