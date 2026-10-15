"use client";
import * as React from "react";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { billingFailure, useCashierOrder, type CashierOwner } from "./use-cashier-order";
import { LiveQrPanel } from "./live-qr-panel";
type Catalog = { status: "loading" } | { status: "error"; denied: boolean; message: string } | { status: "ready"; packages: billing.CreditPackage[]; wallet: billing.CreditWallet };
export function LiveCashierDialog({ owner, sessionToken, open, onOpenChange, onCredited }: { owner: CashierOwner; sessionToken: string; open: boolean; onOpenChange: (open: boolean) => void; onCredited: () => void }) {
  const scope = `${sessionToken}:${owner.ownerType}:${owner.ownerId}`;
  const payment = useCashierOrder(owner, sessionToken, open);
  const [catalog, setCatalog] = React.useState<{ scope: string; data: Catalog }>({ scope, data: { status: "loading" } });
  const [revision, retry] = React.useReducer((x: number) => x + 1, 0);
  const [selected, select] = React.useState<string | null>(null);
  const [walletRevision, refreshWallet] = React.useReducer((x: number) => x + 1, 0);
  const [creditedWallet, setCreditedWallet] = React.useState<billing.CreditWallet | null>(null);
  const [walletError, setWalletError] = React.useState(false);
  const notified = React.useRef<string | null>(null);
  const catalogData = catalog.scope === scope ? catalog.data : { status: "loading" as const };
  React.useEffect(() => { select(null); setCreditedWallet(null); setWalletError(false); notified.current = null; }, [scope]);
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCatalog({ scope, data: { status: "loading" } });
    const options = { sessionToken, signal: controller.signal };
    void Promise.all([
      apiRequest<unknown>(billing.operations.getBillingConfig.path, options),
      apiRequest<unknown>(billing.operations.listPackages.path, { ...options, query: { ownerType: owner.ownerType } }),
      apiRequest<unknown>(billing.operations.getWallet.path, { ...options, query: { ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}) } }),
    ]).then(([configRaw, packagesRaw, walletRaw]) => {
      const config = billing.operations.getBillingConfig.out.parse(configRaw);
      if (!config.enabledProviders.includes("wechat")) throw new Error("PROVIDER_UNAVAILABLE");
      const packages = billing.operations.listPackages.out.parse(packagesRaw).items;
      const { wallet } = billing.operations.getWallet.out.parse(walletRaw);
      if (wallet.ownerType !== owner.ownerType || wallet.ownerId !== owner.ownerId || packages.some(p => p.ownerType !== "both" && p.ownerType !== owner.ownerType)) throw new Error("CATALOG_SCOPE_MISMATCH");
      if (!controller.signal.aborted) setCatalog({ scope, data: { status: "ready", packages, wallet } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalog({ scope, data: { status: "error", denied: error instanceof ApiError && error.status === 403, message: billingFailure(error) } });
    });
    return () => controller.abort();
  }, [open, scope, sessionToken, owner.ownerType, owner.ownerId, revision]);
  React.useEffect(() => {
    if (!open || payment.order?.status !== "SUCCESS") return;
    const orderNo = payment.order.orderNo;
    if (notified.current !== orderNo) { notified.current = orderNo; onCredited(); }
    const controller = new AbortController(); setCreditedWallet(null); setWalletError(false);
    void apiRequest<unknown>(billing.operations.getWallet.path, { sessionToken, signal: controller.signal, query: { ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}) } })
      .then(raw => { const { wallet } = billing.operations.getWallet.out.parse(raw); if (wallet.ownerId !== owner.ownerId || wallet.ownerType !== owner.ownerType) throw new Error("WALLET_SCOPE_MISMATCH"); if (!controller.signal.aborted) setCreditedWallet(wallet); })
      .catch(() => { if (!controller.signal.aborted) setWalletError(true); });
    return () => controller.abort();
  }, [open, scope, payment.order?.orderNo, payment.order?.status, sessionToken, owner.ownerId, owner.ownerType, walletRevision, onCredited]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="billing-cashier-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogTitle>购买额度</DialogTitle><DialogDescription>{owner.ownerType === "team" ? "为当前组织充值" : "为个人账户充值"}，使用微信扫码支付。关闭窗口会保留当前订单。</DialogDescription>
    {payment.order ? <>
      <LiveQrPanel order={payment.order} refresh={() => { void payment.refresh(); }} regenerate={payment.regenerate} />
      {payment.order.status === "SUCCESS" && <div role="status" className="text-13">
        {creditedWallet ? <p data-testid="billing-updated-balance">当前余额 {creditedWallet.balance} 额度</p> : <p>支付已确认，{walletError ? "余额暂未更新，请重试查询。" : "正在刷新余额…"}</p>}
        {walletError && <Button variant="outline" onClick={refreshWallet}>重试余额查询</Button>}
      </div>}
    </> : <>
      {catalogData.status === "loading" && <p role="status">正在查询套餐与账户…</p>}
      {catalogData.status === "error" && <div data-testid={catalogData.denied ? "billing-cashier-denied" : "billing-catalog-error"}><p role="status">{catalogData.message}</p><Button variant="outline" onClick={retry}>重新查询</Button></div>}
      {catalogData.status === "ready" && <>
        <p className="text-13 text-muted-foreground">当前余额 {catalogData.wallet.balance} 额度</p>
        {catalogData.packages.length === 0 ? <p data-testid="billing-packages-empty" role="status">暂无可购买套餐，请稍后再来。</p> : <>
          <div role="radiogroup" aria-label="充值套餐" className="grid gap-3 sm:grid-cols-2">{catalogData.packages.map(pack => <label key={pack.packageId} className="cursor-pointer space-y-2 rounded-lg border p-4 focus-within:ring-2 focus-within:ring-ring">
            <input type="radio" name="billing-package" value={pack.packageId} checked={selected === pack.packageId} onChange={() => select(pack.packageId)} disabled={payment.creating || payment.uncertain} />
            <span className="ml-2 font-semibold">{pack.displayAmount}</span><span className="block text-13">{pack.totalCredits} 额度{pack.bonusCredits > 0 ? `（含赠送 ${pack.bonusCredits}）` : ""}</span>
          </label>)}</div>
          <Button data-testid="billing-generate-qr" disabled={!selected || payment.creating || payment.uncertain} onClick={() => { if (selected) void payment.create(selected); }}>{payment.creating ? "正在生成…" : "生成二维码"}</Button>
        </>}
      </>}
    </>}
    {payment.message && <p data-testid="billing-refresh-hint" role="status" className="text-13 text-muted-foreground">{payment.message}</p>}
  </DialogContent></Dialog>;
}
