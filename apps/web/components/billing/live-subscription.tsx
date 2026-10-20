"use client";
import * as React from "react";
import { billingSubscription } from "@repo/contracts";
import { ApiError, apiRequest } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navigateToStripe } from "./stripe-navigation";

type Info = ReturnType<typeof billingSubscription.operations.getSubscriptionInfo.out.parse>;
type SubscriptionRead = { status: "loading" } | { status: "ready"; data: Info } | { status: "error"; message: string };
type PendingCheckout = { url: string; createdAt: number; lastObservedStatus: billingSubscription.SubscriptionStatus };
const labels: Record<billingSubscription.SubscriptionStatus, string> = {
  none: "暂无订阅", active: "已订阅", trialing: "试用中", past_due: "付款逾期", canceled: "已取消",
  incomplete: "待完成付款", unpaid: "待支付", paused: "订阅已暂停", incomplete_expired: "首次付款已过期",
};
const POLL_LIMIT = 6;
const POLL_DELAY = 3000;
const PENDING_LIFETIME = 24 * 60 * 60 * 1000;

function trustedStripeUrl(raw: unknown, management: boolean): string {
  const { url } = billingSubscription.SubscriptionLink.parse(raw);
  const target = new URL(url);
  const hosts = management ? ["billing.stripe.com"] : ["buy.stripe.com", "checkout.stripe.com"];
  if (target.protocol !== "https:" || target.username || target.password || target.port || !hosts.includes(target.hostname)) {
    throw new Error("Invalid payment destination");
  }
  return url;
}
function pendingKey(userId: string) { return `billing.stripe.checkout:${userId}`; }
function readPending(userId: string): PendingCheckout | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(pendingKey(userId)) ?? "null") as PendingCheckout | null;
    if (!raw || typeof raw.createdAt !== "number" || Date.now() - raw.createdAt >= PENDING_LIFETIME || raw.createdAt > Date.now()) return null;
    return { url: trustedStripeUrl({ url: raw.url }, false), createdAt: raw.createdAt, lastObservedStatus: billingSubscription.SubscriptionStatus.parse(raw.lastObservedStatus ?? "none") };
  } catch { return null; }
}
function isReturnHint(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  // These are only read-refresh hints. No query parameter can grant an entitlement.
  return ["subscription_return", "stripe", "subscription", "checkout", "session_id"].some((key) => params.has(key));
}

export function LiveSubscription({ state, retry, stripeEnabled, userId, sessionToken }: {
  state: SubscriptionRead; retry: () => void; stripeEnabled: boolean; userId: string; sessionToken: string;
}) {
  const [pending, setPending] = React.useState<PendingCheckout | null>(() => readPending(userId));
  const [returning, setReturning] = React.useState(() => !!readPending(userId) || isReturnHint());
  const [polls, setPolls] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  const eligibility = state.status === "ready" ? billingSubscription.subscriptionEligibility(state.data.status) : null;
  const checkoutUnconfirmed = !!pending && eligibility?.canCreateSubscription;
  const waiting = returning && (state.status !== "ready" || state.data.status === "none" || state.data.status === "incomplete" || !!checkoutUnconfirmed);

  const canRestart = waiting && !pending && polls >= POLL_LIMIT && state.status === "ready" && state.data.status === "none";

  React.useEffect(() => {
    if (state.status !== "ready") return;
    const newlyTerminal = pending && ["canceled", "incomplete_expired"].includes(state.data.status)
      && state.data.status !== pending.lastObservedStatus;
    if (newlyTerminal || eligibility?.hasEffectivePro || (pending && !eligibility?.canCreateSubscription && state.data.status !== "incomplete")) {
      setPending(null);
      try { sessionStorage.removeItem(pendingKey(userId)); } catch { /* Storage may be unavailable. */ }
    } else if (pending && pending.lastObservedStatus !== state.data.status) {
      const next = { ...pending, lastObservedStatus: state.data.status };
      setPending(next);
      try { sessionStorage.setItem(pendingKey(userId), JSON.stringify(next)); } catch { /* In-memory reuse still works. */ }
    }
    if (returning && !waiting) setReturning(false);
  }, [state, eligibility?.hasEffectivePro, eligibility?.canCreateSubscription, pending, userId, returning, waiting]);

  React.useEffect(() => {
    if (!waiting || state.status !== "ready" || polls >= POLL_LIMIT) return;
    const timer = window.setTimeout(() => { setPolls((count) => count + 1); retry(); }, POLL_DELAY);
    return () => window.clearTimeout(timer);
  }, [waiting, state, polls, retry]);

  async function openHostedPage() {
    if (request.current || !stripeEnabled || !eligibility || state.status !== "ready") return;
    const management = eligibility.canManageSubscription;
    setBusy(true); setError(null);
    const controller = new AbortController(); request.current = controller;
    try {
      const operation = management ? billingSubscription.operations.getManagementLink : billingSubscription.operations.getUpgradeLink;
      const url = !management && pending ? pending.url : trustedStripeUrl(await apiRequest<unknown>(operation.path, { sessionToken, signal: controller.signal }), management);
      if (controller.signal.aborted) return;
      if (!management) {
        const next = pending ?? { url, createdAt: Date.now(), lastObservedStatus: state.data.status };
        setPending(next);
        try { sessionStorage.setItem(pendingKey(userId), JSON.stringify(next)); } catch { /* In-memory reuse still works. */ }
      }
      setReturning(true); setPolls(0);
      navigateToStripe(url);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.status === 503) {
        setError("暂时无法确认订阅状态，请刷新状态后重试。");
      } else if (failure instanceof ApiError && failure.reasonCode === "payment_provider_not_configured") {
        setError("订阅支付暂不可用，请稍后重试。");
      } else {
        setError("暂时无法打开订阅页面，请刷新状态后重试。");
      }
      retry();
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = null;
    }
  }
  const refresh = () => { setPolls(0); setError(null); retry(); };
  const end = state.status === "ready" && state.data.currentPeriodEnd ? new Date(state.data.currentPeriodEnd) : null;
  return <>
    {state.status === "loading" && <div data-testid="billing-subscription-loading" role="status" aria-label="正在查询订阅查询" className="h-16 animate-pulse rounded-control bg-muted" />}
    {state.status === "error" && <div data-testid="err-billing-subscription" className="space-y-3"><p role="status" className="text-13 text-muted-foreground">暂时无法确认订阅状态。{state.message}</p><Button variant="outline" size="sm" onClick={refresh} aria-label="重试订阅查询">重试</Button></div>}
    {state.status === "ready" && <div className="space-y-3">
      {waiting && eligibility?.canCreateSubscription ? <Badge data-testid="billing-subscription-status" tone="neutral">付款结果确认中</Badge>
        : <Badge data-testid="billing-subscription-status" tone={eligibility?.hasEffectivePro ? "success" : "neutral"}>{labels[state.data.status]}</Badge>}
      {eligibility?.hasEffectivePro && <p className="text-13">Pro 权益已生效</p>}
      {end && !Number.isNaN(end.valueOf()) && <p className="text-13">本期结束：{end.toLocaleDateString("zh-CN")}</p>}
      {state.data.cancelAtPeriodEnd && <p className="text-13 text-muted-foreground">将在本期结束后取消</p>}
      {eligibility?.canManageSubscription && !eligibility.hasEffectivePro && <p className="text-13 text-muted-foreground">当前 Pro 权益未生效，可前往账单页面处理付款或恢复订阅。</p>}
      {stripeEnabled && <Button disabled={busy || (!!error && !checkoutUnconfirmed) || (waiting && !!eligibility?.canCreateSubscription && !pending && !canRestart)} onClick={() => void openHostedPage()}>
        {busy ? "正在打开…" : eligibility?.canManageSubscription ? (eligibility.hasEffectivePro ? "管理订阅" : "处理订阅付款") : pending ? "继续订阅付款" : canRestart ? "重新开始订阅" : "订阅 Pro"}
      </Button>}
    </div>}
    {waiting && <p role="status" className="text-13 text-muted-foreground">{polls >= POLL_LIMIT ? (canRestart ? "付款结果尚未确认。如确认尚未付款，可重新开始订阅；已付款请勿重复购买。" : "付款结果尚未确认，可稍后刷新状态。请勿重复购买。") : "正在确认付款结果，请稍候。订阅权益以账户同步结果为准。"}</p>}
    {error && <p role="alert" className="text-13 text-muted-foreground">{error}</p>}
    {state.status === "ready" && <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>刷新订阅状态</Button>}
    {!stripeEnabled && <p className="text-12 text-muted-foreground">订阅购买与账单管理暂不可用，请稍后再试。</p>}
    {stripeEnabled && <p className="text-12 text-muted-foreground">价格与订阅条款以 Stripe 支付页面为准。订阅不会增加充值额度。</p>}
  </>;
}
