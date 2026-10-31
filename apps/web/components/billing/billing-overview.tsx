"use client";
import { LiveCashierDialog } from "./live-cashier-dialog";
import { SubscriptionHistory } from "./subscription-history";
import { LiveSubscription } from "./live-subscription";
import * as React from "react";
import Link from "next/link";
import { billingCredits, billingSubscription } from "@repo/contracts";
import { CreditCard, Wallet } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ReadState<T> = { status: "loading" } | { status: "ready"; data: T; refreshing?: boolean; refreshError?: string } | { status: "error"; message: string };
interface ReadOperation<T> {
  path: string;
  query?: Record<string, string>;
  parse: (raw: unknown, userId: string) => T;
}
const configRead = {
  path: billingCredits.operations.getBillingConfig.path,
  parse: (raw: unknown) => billingCredits.operations.getBillingConfig.out.parse(raw),
};
const walletRead = {
  path: billingCredits.operations.getWallet.path,
  query: { ownerType: "user" },
  parse: (raw: unknown, userId: string) => {
    const { wallet } = billingCredits.operations.getWallet.out.parse(raw);
    if (wallet.ownerType !== "user" || wallet.ownerId !== userId) throw new Error("BILLING_WALLET_SCOPE_MISMATCH");
    return wallet;
  },
};
const subscriptionRead = {
  path: billingSubscription.operations.getSubscriptionInfo.path,
  parse: (raw: unknown) => billingSubscription.operations.getSubscriptionInfo.out.parse(raw),
};

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "此项服务暂未开放。你仍可以查看我的 AI 用量。";
  if (error instanceof ApiError && error.status === 401) return "登录已失效，请重新登录后查看。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有查看权限。";
  return "暂时无法查询，请重试。已有余额和订阅不会因此改变。";
}

function useBillingRead<T>(operation: ReadOperation<T>, userId: string, sessionToken: string) {
  const [state, setState] = React.useState<ReadState<T>>({ status: "loading" });
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(previous => previous.status === "ready" ? { ...previous, refreshing: true, refreshError: undefined } : { status: "loading" });
    void apiRequest<unknown>(operation.path, { query: operation.query, sessionToken, signal: controller.signal })
      .then((raw) => {
        const data = operation.parse(raw, userId);
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState(previous => previous.status === "ready" ? { ...previous, refreshing: false, refreshError: failureMessage(error) } : { status: "error", message: failureMessage(error) });
      });
    return () => controller.abort();
  }, [operation, userId, sessionToken, revision]);
  return { state, retry };
}

function ReadNotice({ state, name, label, retry }: { state: ReadState<unknown>; name: string; label: string; retry: () => void }) {
  if (state.status === "loading") return <div data-testid={`billing-${name}-loading`} role="status" aria-label={`正在查询${label}`} className="h-16 animate-pulse rounded-control bg-muted" />;
  if (state.status === "ready" && state.refreshError) return <div data-testid={`err-billing-${name}`} className="space-y-2">
    <p role="status" className="text-13 text-muted-foreground">暂时无法刷新{label}，显示上次查询结果。</p>
    <Button variant="outline" size="sm" onClick={retry} aria-label={`重试${label}`}>重试</Button>
  </div>;
  if (state.status === "error") return <div data-testid={`err-billing-${name}`} className="space-y-3">
    <p role="status" className="text-13 text-muted-foreground">{state.message}</p>
    <Button variant="outline" size="sm" onClick={retry} aria-label={`重试${label}`}>重试</Button>
  </div>;
  return null;
}

/** Account discovery remains available even when a deployment has no payment channel.
 * Each read fails independently; missing services never become fabricated zero balances.
 */
export function BillingOverview({ userId, sessionToken, openOnReady = false, onPurchaseOpened }: { userId: string; sessionToken: string; openOnReady?: boolean; onPurchaseOpened?: () => void }) {
  const purchaseButton = React.useRef<HTMLButtonElement>(null);
  const restorePurchaseFocus = React.useCallback(() => purchaseButton.current?.focus(), []);
  const [cashierOpen, setCashierOpen] = React.useState(false);
  const config = useBillingRead(configRead, userId, sessionToken);
  const wallet = useBillingRead(walletRead, userId, sessionToken);
  const subscription = useBillingRead(subscriptionRead, userId, sessionToken);
  const providers = config.state.status === "ready" ? config.state.data.enabledProviders : [];
  const consumed = React.useRef(false);
  React.useEffect(() => {
    const returningOrder = new URLSearchParams(window.location.search).has("credit_order");
    if (!openOnReady && !returningOrder) { consumed.current = false; return; }
    // Existing payment recovery must remain reachable when new purchases are disabled.
    if (!consumed.current && (returningOrder || config.state.status === "ready" && config.state.data.enabledProviders.length > 0)) {
      consumed.current = true; setCashierOpen(true); if(openOnReady)onPurchaseOpened?.();
    }
  }, [openOnReady, config.state, onPurchaseOpened]);
  const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return <div data-testid="billing-overview" className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-2">
      <h1 className="text-24 font-semibold">额度与订阅</h1>
      <p className="text-13 text-muted-foreground">按需充值，或购买月度套餐。</p>
    </header>
    <div className="grid items-start gap-4 md:grid-cols-2">
      <Card data-testid="billing-wallet-card">
        <CardHeader><CardTitle className="flex items-center gap-2"><Wallet aria-hidden className="h-4 w-4" />购买 credit</CardTitle><CardDescription>充值额度长期有效</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <ReadNotice state={wallet.state} name="wallet" label="额度查询" retry={wallet.retry} />
          {wallet.state.status === "ready" && <>
            <div><p className="text-12 text-muted-foreground">剩余 credit</p><p data-testid="billing-wallet-balance" className="text-30 font-semibold tabular-nums">{number(wallet.state.data.permanentBalance ?? wallet.state.data.balance)} <span className="text-13 font-normal text-muted-foreground">credit</span></p></div>
            {wallet.state.data.balance < 0 && <p className="text-13 text-destructive">待结算欠额 {number(Math.abs(wallet.state.data.balance))} 额度。余额为负，充值后可发起新请求；已开始的请求可以完成。</p>}

          </>}
          <div className="flex flex-wrap gap-2">
          {providers.length > 0 && <Button ref={purchaseButton} onClick={() => setCashierOpen(true)}>购买 credit</Button>}
          <Button asChild variant="outline"><Link href="/usage">查看历史使用</Link></Button>
          </div>
        </CardContent>
      </Card>
      <Card data-testid="billing-subscription-card">
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard aria-hidden className="h-4 w-4" />月度套餐</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <LiveSubscription key={`${userId}:${sessionToken}`} state={subscription.state} retry={subscription.retry} wechatEnabled={providers.includes("wechat")} stripeEnabled={providers.includes("stripe")} userId={userId} sessionToken={sessionToken} onCreditGranted={wallet.retry} />
          <SubscriptionHistory key={`${userId}:${sessionToken}`} sessionToken={sessionToken} />
        </CardContent>
      </Card>
    </div>
    <LiveCashierDialog key={`${userId}:${sessionToken}`} owner={{ ownerType: "user", ownerId: userId }} sessionToken={sessionToken} open={cashierOpen} onOpenChange={setCashierOpen} onCredited={wallet.retry} focusFallback={restorePurchaseFocus} />
  </div>;
}
