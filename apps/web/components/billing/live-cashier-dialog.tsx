"use client";
import * as React from "react";
import { ArrowRight, QrCode } from "lucide-react";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCashierOrder, type CashierOwner } from "./use-cashier-order";
import { CashierLedgerHistory } from "./cashier-ledger-history";
import { WalletAvailability } from "./wallet-availability";
import { LiveQrPanel } from "./live-qr-panel";
import { cn } from "@/lib/utils";
type Read<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string; denied: boolean };
function useCashierRead<T>(path: string, query: Record<string, string>, parse: (raw: unknown) => T, scope: string, sessionToken: string, open: boolean, revision: string) {
  const [result, setResult] = React.useState<{ key: string; value: Read<T> }>({ key: "", value: { state: "loading" } });
  const [retryCount, retry] = React.useReducer((x: number) => x + 1, 0);
  const current = React.useRef(parse); current.current = parse;
  const queryKey = JSON.stringify(query);
  const key = `${scope}:${path}:${queryKey}:${revision}:${retryCount}`;
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setResult({ key, value: { state: "loading" } });
    void apiRequest<unknown>(path, { query: JSON.parse(queryKey), sessionToken, signal: controller.signal }).then(raw => {
      const data = current.current(raw); if (!controller.signal.aborted) setResult({ key, value: { state: "ready", data } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, value: { state: "error", message: "暂时无法查询，请重试。", denied: error instanceof ApiError && [401, 403].includes(error.status) } });
    });
    return () => controller.abort();
  }, [path, queryKey, scope, sessionToken, open, revision, retryCount, key]);
  return { result: result.key === key ? result.value : { state: "loading" as const }, retry };
}
export function LiveCashierDialog({ owner, sessionToken, open, onOpenChange, onCredited, focusFallback }: { owner: CashierOwner; sessionToken: string; open: boolean; onOpenChange: (open: boolean) => void; onCredited: () => void; focusFallback?: () => void }) {
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const scope = `${sessionToken}:${owner.ownerType}:${owner.ownerId}`;
  const payment = useCashierOrder(owner, sessionToken, open);
  const [selection, select] = React.useState<{ scope: string; id: string } | null>(null);
  const notified = React.useRef<string | null>(null);
  const query = { ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}) };
  const success = payment.order?.status === "SUCCESS" ? payment.order.orderNo : "initial";
  const config = useCashierRead(billing.operations.getBillingConfig.path, {}, raw => billing.operations.getBillingConfig.out.parse(raw), scope, sessionToken, open, "config");
  const catalog = useCashierRead(billing.operations.listPackages.path, { ownerType: owner.ownerType }, raw => {
    const { items } = billing.operations.listPackages.out.parse(raw);
    if (items.some(p => p.ownerType !== "both" && p.ownerType !== owner.ownerType)) throw new Error("CATALOG_SCOPE_MISMATCH");
    return items;
  }, scope, sessionToken, open, "packages");
  const wallet = useCashierRead(billing.operations.getWallet.path, query, raw => {
    const { wallet } = billing.operations.getWallet.out.parse(raw);
    if (wallet.ownerId !== owner.ownerId || wallet.ownerType !== owner.ownerType) throw new Error("WALLET_SCOPE_MISMATCH");
    return wallet;
  }, scope, sessionToken, open, success);
  const ledger = useCashierRead(billing.operations.listTransactions.path, { ...query, limit: "5" }, raw => billing.operations.listTransactions.out.parse(raw), scope, sessionToken, open, success);
  React.useEffect(() => {
    if (success !== "initial" && notified.current !== `${scope}:${success}`) { notified.current = `${scope}:${success}`; onCredited(); }
  }, [scope, success, onCredited]);
  const denied = payment.accessError || [config.result, catalog.result, wallet.result, ledger.result].some(r => r.state === "error" && r.denied);
  const packages = catalog.result.state === "ready" ? catalog.result.data : [];
  const selected = selection?.scope === scope && packages.some(p => p.packageId === selection.id) ? selection.id : packages[0]?.packageId ?? null;
  const locked = !!payment.order || payment.creating || payment.uncertain;
  const [chosenProvider, chooseProvider] = React.useState<"wechat" | "stripe">("wechat");
  const providers = config.result.state === "ready" ? config.result.data.enabledProviders : [];
  const provider = payment.order?.provider ?? (providers.includes(chosenProvider) ? chosenProvider : providers[0] ?? "wechat");
  const configured = config.result.state === "ready" && config.result.data.enabledProviders.length > 0;
  const retryAll = () => { config.retry(); catalog.retry(); wallet.retry(); ledger.retry(); void payment.refresh(); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="billing-cashier-dialog" onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected && returnFocus.current !== document.body) returnFocus.current.focus(); else focusFallback?.(); }} className="max-h-[90dvh] max-w-6xl gap-6 overflow-y-auto p-5 sm:p-8">
    <div className="space-y-2 pr-6"><DialogTitle className="text-24">购买额度</DialogTitle><DialogDescription className="text-14">{owner.ownerType === "team" ? "为当前组织充值，用于团队的 AI 使用。" : "为个人账户充值，用于个人工作区的 AI 使用。"}关闭窗口会保留当前订单。</DialogDescription></div>
    {denied ? <div data-testid="billing-cashier-denied"><p role="status">登录已失效或你没有此账户的访问权限。请重新登录或联系管理员。</p><Button variant="outline" onClick={retryAll}>重新验证权限</Button></div> : <>
      <div data-testid="billing-cashier-layout" className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0 space-y-5">
        {config.result.state === "loading" && <p role="status">正在查询支付渠道…</p>}
        {config.result.state === "error" && <p role="status">支付渠道暂时无法查询。<Button variant="outline" onClick={config.retry}>重试渠道</Button></p>}
        {config.result.state === "ready" && !configured && <p data-testid="billing-cashier-unavailable" role="status">支付暂未开通。</p>}
        {configured && <>
          {catalog.result.state === "loading" && <p role="status">正在查询套餐…</p>}
          {catalog.result.state === "error" && <p role="status">套餐暂时无法查询。<Button variant="outline" onClick={catalog.retry}>重试套餐</Button></p>}
          {catalog.result.state === "ready" && (packages.length === 0 ? <p data-testid="billing-packages-empty" role="status">暂无可购买套餐，请稍后再来。</p> : <>
            <div role="radiogroup" aria-label="充值套餐" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">{packages.map(pack => <label key={pack.packageId} className={cn("relative flex min-w-0 flex-col rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring sm:p-5", locked ? "cursor-default" : "cursor-pointer hover:bg-muted", (payment.order?.packageId ?? selected) === pack.packageId ? "border-background-foreground bg-muted" : "border-border bg-card text-card-foreground")}>
              <input className="absolute inset-0 m-0 h-full w-full cursor-inherit opacity-0" type="radio" name="billing-package" value={pack.packageId} checked={(payment.order?.packageId ?? selected) === pack.packageId} onChange={() => select({ scope, id: pack.packageId })} disabled={locked} />
              <span className="text-24 font-semibold tabular-nums sm:text-30">{pack.totalCredits.toLocaleString("zh-CN")}</span><span className="mt-1 text-13 text-muted-foreground">额度{pack.bonusCredits > 0 ? `（含赠送 ${pack.bonusCredits}）` : ""}</span>
              <span className="mt-5 text-16 font-semibold tabular-nums">{pack.displayAmount}</span>
            </label>)}</div>
            {providers.length > 1 && <div role="radiogroup" aria-label="支付渠道" className="flex gap-3">{providers.map(value => <label key={value}><input type="radio" name="topup-provider" checked={provider === value} disabled={locked} onChange={() => chooseProvider(value)}/>{value === "wechat" ? "微信支付" : "Stripe"}</label>)}</div>}
            {!payment.order && <Button variant="primary" size="lg" className="w-full sm:w-auto" data-testid="billing-generate-qr" disabled={!selected || payment.creating || payment.uncertain} onClick={() => { if (selected) void payment.create(selected, provider); }}><QrCode aria-hidden className="mr-1 h-5 w-5"/>{payment.creating ? "正在生成…" : provider === "stripe" ? "创建付款订单" : "生成支付二维码"}</Button>}
          </>)}
        </>}
        {payment.order?.status === "SUCCESS" && <Button variant="primary" size="lg" className="w-full sm:w-auto" data-testid="billing-buy-again" onClick={payment.buyAgain}>再次购买<ArrowRight aria-hidden className="ml-2 h-4 w-4"/></Button>}
        {payment.order && ["PENDING", "PROCESSING"].includes(payment.order.status) && <p className="text-13 text-muted-foreground">当前订单结束后，可重新选择套餐购买。</p>}
        {payment.message && <p data-testid="billing-refresh-hint" role="status" className="text-13 text-muted-foreground">{payment.message}</p>}
      </div>
      {payment.order ? <LiveQrPanel key={payment.order.orderNo} order={payment.order} refresh={() => { void payment.refresh(); }} regenerate={payment.regenerate} cancel={() => { void payment.cancel(); }} cancelling={payment.cancelling} /> : <section aria-label="微信支付订单" className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-card border border-border bg-muted/30 p-6 text-center"><div className="flex h-24 w-24 items-center justify-center rounded-card border border-dashed border-border bg-card text-muted-foreground"><QrCode aria-hidden className="h-12 w-12"/></div><div className="space-y-2"><p className="text-14 font-medium">{payment.creating ? "正在生成支付二维码" : provider === "stripe" ? "使用 Stripe 付款" : "使用微信扫码支付"}</p><p className="text-13 text-muted-foreground">选择充值套餐后创建付款订单。</p></div></section>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
      {wallet.result.state === "loading" && <p role="status">{success === "initial" ? "正在查询余额…" : "支付已确认，正在刷新余额…"}</p>}
      {wallet.result.state === "error" && <p role="status">{success === "initial" ? "余额暂时无法查询。" : "支付已确认，余额暂未更新。"}<Button variant="outline" onClick={wallet.retry}>重试余额查询</Button></p>}
      {wallet.result.state === "ready" && <WalletAvailability reservedCredits={wallet.result.data.reservedCredits} availableBalance={wallet.result.data.availableBalance}/>}
      {wallet.result.state === "ready" && <p data-testid="billing-updated-balance" className="text-13 text-muted-foreground"><span data-testid="billing-cashier-balance">当前余额 {wallet.result.data.balance} 额度</span></p>}
      </div>
      <section data-testid="billing-recent-ledger" aria-label="最近额度流水" className="overflow-hidden rounded-card border border-border"><h3 className="border-b border-border px-5 py-4 text-14 font-semibold">最近额度流水</h3><div className="p-5">
        {ledger.result.state === "loading" && <p role="status">正在查询流水…</p>}
        {ledger.result.state === "error" && <p role="status">流水暂时无法查询。<Button variant="outline" onClick={ledger.retry}>重试流水查询</Button></p>}
        {ledger.result.state === "ready" && <CashierLedgerHistory key={`${scope}:${success}`} owner={owner} sessionToken={sessionToken} initial={ledger.result.data} onDenied={payment.revoke} />}
      </div></section>
    </>}
  </DialogContent></Dialog>;
}
