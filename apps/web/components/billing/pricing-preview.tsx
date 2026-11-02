"use client";
import * as React from "react";
import { ArrowLeft, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PricingTeamHistoryPreview } from "./pricing-team-history-preview";
import { PricingAccountPreview } from "./pricing-account-preview";
import { PricingEnterprisePreview } from "./pricing-enterprise-preview";
import { PricingPurchaseDialog, type PurchaseKind } from "./pricing-purchase-dialog";
import { PRICING_STATES, STATE_LABELS, type PricingCycle, type PricingRegion, type PricingState, type PricingView } from "./pricing-preview-data";

export function PricingPreview() {
  const [region, setRegion] = React.useState<PricingRegion>("cn");
  const [view, setView] = React.useState<PricingView>("personal");
  const [state, setState] = React.useState<PricingState>("default");
  const [cycle, setCycle] = React.useState<PricingCycle>("month");
  const [purchaseCycle, setPurchaseCycle] = React.useState<PricingCycle>("month");
  const [free, setFree] = React.useState(false);
  const [expired, setExpired] = React.useState(false);
  const [purchase, setPurchase] = React.useState<PurchaseKind | null>(null);
  const [history, setHistory] = React.useState<"usage" | "subscription" | "management" | null>(null);
  const [message, setMessage] = React.useState("");
  function openPurchase(kind: PurchaseKind) { setPurchaseCycle(cycle); setPurchase(kind); }
  function changeView(value: PricingView) { setView(value); setState("default"); setMessage(""); }
  return <div className="min-h-screen bg-background text-background-foreground">
    <div className="border-b border-border bg-muted px-4 py-3" data-testid="pricing-preview-controls">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <Badge tone="outline">UI 设计预览</Badge><span className="text-12 text-muted-foreground">模拟数据，不会扣款或修改账户</span>
        <div className="flex flex-wrap gap-2 sm:ml-auto"><Select data-testid="pricing-region" aria-label="预览地区" value={region} onValueChange={value => { setRegion(value as PricingRegion); setMessage(""); }} options={[{ value: "cn", label: "中国 · CNY" }, { value: "us", label: "美国 · USD" }, { value: "devapp", label: "DevApp · 双渠道" }]} />
          <Select data-testid="pricing-state" aria-label="预览状态" value={state} onValueChange={value => setState(value as PricingState)} options={PRICING_STATES.map(value => ({ value, label: STATE_LABELS[value] }))} /></div>
      </div>
    </div>
    <header className="border-b border-border bg-card px-4"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-4"><div className="flex items-center gap-3"><Layers3 className="h-5 w-5" aria-hidden="true" /><span className="text-14 font-semibold">WorkspaceX</span><span className="text-12 text-muted-foreground">{view === "personal" ? "个人账户" : view === "team" ? "山海设计工作室" : "平台管理"}</span></div><nav className="flex gap-1" aria-label="预览场景">{([{ key: "personal", label: "个人" }, { key: "team", label: "团队" }, { key: "admin", label: "管理员" }] as const).map(item => <Button data-testid={`pricing-view-${item.key}`} key={item.key} size="sm" variant={view === item.key ? "outline" : "ghost"} aria-pressed={view === item.key} onClick={() => changeView(item.key)}>{item.label}</Button>)}</nav></div></header>
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-3 text-12 text-muted-foreground">{view === "admin" ? "平台管理 / Team" : "账户 / 额度与订阅"}</p><h1 className="text-30 font-semibold tracking-tight">{view === "admin" ? "团队与 Enterprise" : "额度与订阅"}</h1><p className="mt-2 text-13 text-muted-foreground">{view === "admin" ? "套餐状态与额度管理，集中在团队列表。" : view === "team" ? "共享 AI 额度，按已购席位管理团队。" : "按需充值，或订阅每月 AI 额度。"}</p></div>
        {view !== "admin" && <div className="flex flex-wrap gap-2"><Button data-testid="pricing-toggle-cycle" size="sm" variant="outline" onClick={() => setCycle(value => value === "month" ? "year" : "month")}>{cycle === "month" ? "月付示例" : "年付示例"}</Button>{view === "personal" ? <Button data-testid="pricing-toggle-free" size="sm" variant="outline" onClick={() => setFree(value => !value)}>{free ? "查看 Pro" : "查看 Free"}</Button> : <Button data-testid="pricing-toggle-expired" size="sm" variant="outline" onClick={() => setExpired(value => !value)}>{expired ? "查看有效期内" : "查看已到期"}</Button>}</div>}
      </div>
      {(message || state === "success") && <p role="status" data-testid="pricing-saved" className="mb-5 rounded-control bg-success p-3 text-13 text-success-foreground">{message || "操作成功，展示已更新。本页面使用模拟数据。"}</p>}
      {state === "loading" ? <div data-testid="loading" role="status" aria-label="正在加载额度与订阅" className="grid gap-5 md:grid-cols-2">{[0, 1].map(key => <div key={key} className="h-80 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />)}</div> : state === "denied" ? <div data-testid="err-pricing-denied" role="alert" className="rounded-card border border-border bg-card p-8"><h2 className="text-18 font-semibold">没有查看权限</h2><p className="mt-2 text-13 text-muted-foreground">{view === "admin" ? "此页面仅对平台管理员开放。" : "请切换到有权限的账户，或联系团队管理员。"}</p><Button data-testid="pricing-denied-back" className="mt-5" variant="outline" onClick={() => changeView("personal")}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />返回个人账户</Button></div> : state === "depfail" || state === "invalid" ? <div data-testid={`err-pricing-${state}`} role="alert" className="rounded-card border border-border bg-card p-8"><h2 className="text-18 font-semibold">{state === "invalid" ? "请检查购买信息" : "暂时无法获取账户信息"}</h2><p className="mt-2 text-13 text-muted-foreground">{state === "invalid" ? "购买信息已失效，请重新选择套餐并确认金额。" : "请稍后重试。已有余额与订阅不会因此改变。"}</p><Button data-testid="pricing-retry" className="mt-5" variant="outline" onClick={() => setState("default")}>重新加载</Button></div> : state === "empty" ? <div data-testid="empty" className="rounded-card border border-dashed border-border bg-card p-8 text-center"><h2 className="text-18 font-semibold">{view === "admin" ? "还没有团队" : "还没有购买记录"}</h2><p className="mt-2 text-13 text-muted-foreground">{view === "admin" ? "团队创建后，会在此显示套餐与可用额度。" : "查看套餐或购买额度，开始使用 AI。"}</p>{view !== "admin" && <Button data-testid="pricing-empty-plans" className="mt-5" variant="primary" onClick={() => openPurchase("plans")}>查看套餐</Button>}</div> : view === "admin" ? <PricingEnterprisePreview /> : <PricingAccountPreview team={view === "team"} free={view === "personal" && free} expired={view === "team" && expired} region={region} cycle={cycle} onPurchase={openPurchase} onHistory={setHistory} />}
      <footer className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-12 text-muted-foreground"><span>1 credit = 1,000 token · 按实际用量结算</span><span>Community 免费开源自部署</span></footer>
    </main>
    <PricingPurchaseDialog kind={purchase} region={region} cycle={purchase === "seats" ? cycle : purchaseCycle} team={view === "team"} onCycleChange={setPurchaseCycle} onClose={() => setPurchase(null)} onPurchased={setMessage} />
    <Dialog open={history !== null} onOpenChange={open => { if (!open) setHistory(null); }}><DialogContent data-testid="pricing-history-dialog"><DialogHeader><DialogTitle>{history === "usage" ? "AI 用量" : history === "management" ? "管理自动续费" : "订阅历史"}</DialogTitle><DialogDescription>设计预览 · {view === "team" ? "山海设计工作室" : "个人账户"}</DialogDescription></DialogHeader>
      {history === "management" ? <div className="space-y-4"><p className="text-13">正式版本将在 Stripe 安全页面管理付款方式或取消下一期自动续费。当前已付款权益保留至到期。</p><Button data-testid="pricing-portal-preview" variant="outline" onClick={() => { setHistory(null); setMessage("已演示进入 Stripe 订阅管理，不会打开真实账单。"); }}>模拟进入 Stripe 管理</Button></div> : history === "subscription" && view === "team" ? <PricingTeamHistoryPreview region={region} cycle={cycle} expired={expired}/> : <div className="divide-y divide-border text-13">{(history === "usage" ? [{ title: "项目对话", detail: "2026/11/01 14:32 · 8,400 token", value: "−8.40 credit" }, { title: "实时语音", detail: "2026/11/01 10:18 · 12,600 token", value: "−12.60 credit" }, { title: "研究分析", detail: "2026/10/31 16:04 · 35,200 token", value: "−35.20 credit" }] : [{ title: view === "team" && expired ? "订阅已到期" : "订阅已确认", detail: view === "team" && expired ? "2026/10/31 · 本期已结束" : "2026/11/01 · 额度按月发放", value: view === "team" && expired ? "已到期" : "本期有效" }, { title: "历史订单", detail: "历史金额沿用购买时快照", value: "已支付" }]).map(row => <div key={row.title} className="flex flex-wrap justify-between gap-3 py-4"><div><p className="font-medium">{row.title}</p><p className="mt-1 text-12 text-muted-foreground">{row.detail}</p></div><span className="tabular-nums">{row.value}</span></div>)}</div>}
    </DialogContent></Dialog>
  </div>;
}
