"use client";
import * as React from "react";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCashierOrder, type CashierOwner } from "./use-cashier-order";
import { CashierLedgerHistory } from "./cashier-ledger-history";
import { LiveQrPanel } from "./live-qr-panel";
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
export function LiveCashierDialog({ owner, sessionToken, open, onOpenChange, onCredited }: { owner: CashierOwner; sessionToken: string; open: boolean; onOpenChange: (open: boolean) => void; onCredited: () => void }) {
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
  const selected = selection?.scope === scope && packages.some(p => p.packageId === selection.id) ? selection.id : null;
  const configured = config.result.state === "ready" && config.result.data.enabledProviders.includes("wechat");
  const retryAll = () => { config.retry(); catalog.retry(); wallet.retry(); ledger.retry(); void payment.refresh(); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="billing-cashier-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogTitle>购买额度</DialogTitle><DialogDescription>{owner.ownerType === "team" ? "为当前组织充值" : "为个人账户充值"}，使用微信扫码支付。关闭窗口会保留当前订单。</DialogDescription>
    {denied ? <div data-testid="billing-cashier-denied"><p role="status">登录已失效或你没有此账户的访问权限。请重新登录或联系管理员。</p><Button variant="outline" onClick={retryAll}>重新验证权限</Button></div> : <>
      {payment.order ? <LiveQrPanel order={payment.order} refresh={() => { void payment.refresh(); }} regenerate={payment.regenerate} /> : <>
        {config.result.state === "loading" && <p role="status">正在查询支付渠道…</p>}
        {config.result.state === "error" && <p role="status">支付渠道暂时无法查询。<Button variant="outline" onClick={config.retry}>重试渠道</Button></p>}
        {config.result.state === "ready" && !configured && <p data-testid="billing-cashier-unavailable" role="status">微信支付暂未开通。</p>}
        {configured && <>
          {catalog.result.state === "loading" && <p role="status">正在查询套餐…</p>}
          {catalog.result.state === "error" && <p role="status">套餐暂时无法查询。<Button variant="outline" onClick={catalog.retry}>重试套餐</Button></p>}
          {catalog.result.state === "ready" && (packages.length === 0 ? <p data-testid="billing-packages-empty" role="status">暂无可购买套餐，请稍后再来。</p> : <>
            <div role="radiogroup" aria-label="充值套餐" className="grid gap-3 sm:grid-cols-2">{packages.map(pack => <label key={pack.packageId} className="cursor-pointer space-y-2 rounded-lg border p-4 focus-within:ring-2 focus-within:ring-ring">
              <input type="radio" name="billing-package" value={pack.packageId} checked={selected === pack.packageId} onChange={() => select({ scope, id: pack.packageId })} disabled={payment.creating || payment.uncertain} />
              <span className="ml-2 font-semibold">{pack.displayAmount}</span><span className="block text-13">{pack.totalCredits} 额度{pack.bonusCredits > 0 ? `（含赠送 ${pack.bonusCredits}）` : ""}</span>
            </label>)}</div>
            <Button data-testid="billing-generate-qr" disabled={!selected || payment.creating || payment.uncertain} onClick={() => { if (selected) void payment.create(selected); }}>{payment.creating ? "正在生成…" : "生成二维码"}</Button>
          </>)}
        </>}
      </>}
      {wallet.result.state === "loading" && <p role="status">{success === "initial" ? "正在查询余额…" : "支付已确认，正在刷新余额…"}</p>}
      {wallet.result.state === "error" && <p role="status">{success === "initial" ? "余额暂时无法查询。" : "支付已确认，余额暂未更新。"}<Button variant="outline" onClick={wallet.retry}>重试余额查询</Button></p>}
      {wallet.result.state === "ready" && <p data-testid="billing-updated-balance" className="text-13 text-muted-foreground">当前余额 {wallet.result.data.balance} 额度</p>}
      <section aria-label="最近额度流水" className="space-y-2 border-t pt-3"><h3 className="text-13 font-semibold">最近流水</h3>
        {ledger.result.state === "loading" && <p role="status">正在查询流水…</p>}
        {ledger.result.state === "error" && <p role="status">流水暂时无法查询。<Button variant="outline" onClick={ledger.retry}>重试流水查询</Button></p>}
        {ledger.result.state === "ready" && <CashierLedgerHistory key={`${scope}:${success}`} owner={owner} sessionToken={sessionToken} initial={ledger.result.data} onDenied={payment.revoke} />}
      </section>
      {payment.message && <p data-testid="billing-refresh-hint" role="status" className="text-13 text-muted-foreground">{payment.message}</p>}
    </>}
  </DialogContent></Dialog>;
}
