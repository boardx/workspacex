"use client";
import type { z } from "zod";
import * as React from "react";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
export type CashierOwner = { ownerType: "user" | "team"; ownerId: string };
export type LiveOrder = z.infer<typeof billing.BillingOrder>;
/** Only a normal server-confirmed closure permits a new payment intent. */
export function canRegenerateOrder(order: LiveOrder | null): boolean {
  return order?.status === "CLOSED" && order.lastErrorCode === null;
}
function upstreamCreationRejected(error: unknown): boolean {
  return error instanceof ApiError && error.status === 502 && error.raw !== null && typeof error.raw === "object" && "code" in error.raw && error.raw.code === "wechat_upstream_failed";
}
export function billingFailure(error: unknown): string {
  if (upstreamCreationRejected(error)) return "微信下单失败，未生成可支付订单。请重试生成二维码。";
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 403) return "你没有此账户的购买权限。";
    const raw = error.raw;
    const code = raw && typeof raw === "object" && "code" in raw ? raw.code : null;
    if (code === "org_billing_disabled") return "组织已关闭购买，请联系组织管理员。";
    if (code === "package_disabled" || code === "package_not_found") return "此套餐已下架，请刷新套餐。";
    if (code === "payment_provider_not_configured") return "当前支付方式暂未开通。";
  }
  return "暂时无法确认结果，请保留当前页面并联系支持，勿重复付款。";
}
function validateOrder(raw: unknown, owner: CashierOwner, expected?: LiveOrder): LiveOrder {
  const { order } = billing.operations.getPaymentOrder.out.parse(raw);
  if (order.ownerType !== owner.ownerType || order.ownerId !== owner.ownerId || order.currency !== "CNY") throw new Error("ORDER_SCOPE_MISMATCH");
  const terminalStripe=order.provider==="stripe"&&["SUCCESS","CLOSED","FAILED"].includes(order.status)&&order.qrCodeUrl==="pending";
  // Completed Checkout may have no URL; never render the internal placeholder as a link.
  if(!terminalStripe){
  const qr = new URL(order.qrCodeUrl);
  if (order.provider === "stripe" ? (qr.protocol !== "https:" || qr.hostname !== "checkout.stripe.com" || !!qr.port || !!qr.username || !!qr.password || !!qr.hash) : qr.protocol !== "weixin:" || qr.hostname !== "wxpay" || qr.pathname !== "/bizpayurl" || !qr.searchParams.get("pr") || qr.username || qr.password || qr.hash) throw new Error("INVALID_NATIVE_QR");
  }
  if (expected && ["provider", "orderNo", "packageId", "amountFen", "baseCredits", "bonusCredits", "currency", "expiredAt", "qrCodeUrl"].some(key => order[key as keyof LiveOrder] !== expected[key as keyof LiveOrder])) throw new Error("ORDER_SNAPSHOT_MISMATCH");
  return order;
}
/** A completed order stays in this hook when the dialog closes. No GET can create an intent. */
export function useCashierOrder(owner: CashierOwner, sessionToken: string, open: boolean) {
  const scope = `${sessionToken}:${owner.ownerType}:${owner.ownerId}`;
  const [accessError, setAccessError] = React.useState<string | null>(null);
  const currentScope = React.useRef(scope); currentScope.current = scope;
  const [state, setState] = React.useState<{ scope: string; order: LiveOrder | null; creating: boolean; uncertain: boolean; message: string | null }>({ scope, order: null, creating: false, uncertain: false, message: null });
  const active = state.scope === scope ? state : { scope, order: null, creating: false, uncertain: false, message: null };
  const pending = React.useRef<AbortController | null>(null);
  const cancelRequest = React.useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const mounted = React.useRef(true);
  const latest = React.useRef(active); latest.current = active;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  React.useEffect(() => {
    setAccessError(null); setCancelling(false); cancelRequest.current = null;
    setState({ scope, order: null, creating: false, uncertain: false, message: null });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [scope]);
  React.useEffect(() => { if (!open) pending.current?.abort(); }, [open]);
  React.useEffect(() => {
    const orderNo = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("credit_order") : null;
    if (!open || !orderNo || latest.current.order || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setState(value => ({ ...value, uncertain: true }));
    void apiRequest<unknown>(billing.operations.getPaymentOrder.path.replace(":orderNo", encodeURIComponent(orderNo)), { sessionToken, signal: controller.signal }).then(raw => {
      const order = validateOrder(raw, {ownerType:owner.ownerType,ownerId:owner.ownerId});
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) setState({ scope, order, creating: false, uncertain: false, message: null });
    }).catch(() => {
      if (!controller.signal.aborted && currentScope.current === scope) setState(value => ({ ...value, message: "无法恢复付款订单，请联系支持，勿重复付款。" }));
    }).finally(() => { if (pending.current === controller) pending.current = null; });
    return () => controller.abort();
  }, [open, scope, sessionToken, owner.ownerType, owner.ownerId]);
  const refresh = React.useCallback(async () => {
    const order = latest.current.order;
    if (!order || pending.current || !open) return;
    const controller = new AbortController(); pending.current = controller;
    try {
      const path = billing.operations.getPaymentOrder.path.replace(":orderNo", encodeURIComponent(order.orderNo));
      const raw = await apiRequest<unknown>(path, { sessionToken, signal: controller.signal });
      const fresh = validateOrder(raw, { ownerType: owner.ownerType, ownerId: owner.ownerId }, order);
      if ((order.status === "SUCCESS" || order.status === "FAILED") && fresh.status !== order.status) throw new Error("ORDER_STATE_REGRESSION");
      if (order.status === "CLOSED" && fresh.status !== "CLOSED" && fresh.status !== "SUCCESS") throw new Error("ORDER_STATE_REGRESSION");
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) { setAccessError(null); setState(value => ({ ...value, order: fresh, message: null })); }
    } catch (error) {
      if (!controller.signal.aborted && currentScope.current === scope && error instanceof ApiError && [401, 403, 404].includes(error.status)) setAccessError(billingFailure(error));
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) setState(value => ({ ...value, message: "状态暂未更新，订单已保留。请稍后刷新，勿重复付款。" }));
    } finally { if (pending.current === controller) pending.current = null; }
  }, [open, owner.ownerType, owner.ownerId, sessionToken, scope]);
  React.useEffect(() => {
    if (!open || !active.order || !["PENDING", "PROCESSING"].includes(active.order.status)) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { await refresh(); if (!stopped) timer = setTimeout(() => { void tick(); }, 3000); };
    timer = setTimeout(() => { void tick(); }, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, active.order?.orderNo, active.order?.status, active.order, refresh]);
  async function create(packageId: string, provider: "wechat" | "stripe" = "wechat") {
    if (pending.current || latest.current.order || latest.current.creating || latest.current.uncertain || !open) return;
    const controller = new AbortController(); pending.current = controller;
    setState({ scope, order: null, creating: true, uncertain: true, message: null });
    try {
      const body = billing.operations.createPaymentOrder.in.parse({ ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}), packageId, provider });
      const raw = await apiRequest<unknown>(billing.operations.createPaymentOrder.path, { method: "POST", body, sessionToken, signal: controller.signal });
      const order = validateOrder(raw, {ownerType:owner.ownerType,ownerId:owner.ownerId});
      if (order.provider !== provider || order.packageId !== packageId || !["PENDING", "PROCESSING", "SUCCESS", "CLOSED"].includes(order.status)) throw new Error("ORDER_CREATE_MISMATCH");
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) setState({ scope, order, creating: false, uncertain: false, message: null });
    } catch (error) {
      if (mounted.current && currentScope.current === scope) {
        // Only explicit pre-intent client rejections are safe to resubmit. A lost reply is unknown.
        const rejected = upstreamCreationRejected(error) || error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status);
        setState({ scope, order: null, creating: false, uncertain: !rejected, message: controller.signal.aborted ? "请求已中断，结果待确认。请联系支持，勿重复付款。" : billingFailure(error) });
      }
    } finally { if (pending.current === controller) pending.current = null; }
  }
  async function cancel() {
    const order = latest.current.order;
    if (!open || !order || order.status !== "PENDING" || cancelRequest.current) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller; cancelRequest.current = controller;
    setCancelling(true);
    try {
      const path = billing.operations.cancelPaymentOrder.path.replace(":orderNo", encodeURIComponent(order.orderNo));
      const raw = await apiRequest<unknown>(path, { method: "POST", body: {}, sessionToken, signal: controller.signal });
      const fresh = validateOrder(raw, owner, order);
      if (fresh.status === "PENDING") throw new Error("CANCELLATION_UNCONFIRMED");
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) {
        setState(value => ({ ...value, order: fresh, message: fresh.status === "CLOSED" ? "订单已取消，可重新选择套餐。" : "订单正在确认支付结果，请勿重复付款。" }));
      }
    } catch (error) {
      if (mounted.current && currentScope.current === scope) {
        if (error instanceof ApiError && [401,403,404].includes(error.status)) setAccessError(billingFailure(error));
        setState(value => ({ ...value, message: "取消结果尚未确认，订单已保留。请刷新支付状态，勿重复付款。" }));
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (cancelRequest.current === controller) cancelRequest.current = null;
      if (mounted.current && currentScope.current === scope) setCancelling(false);
    }
  }
  function regenerate() {
    if (open && !accessError && canRegenerateOrder(latest.current.order)) resetCompletedOrder();
  }
  function buyAgain() {
    if (open && !accessError && latest.current.order?.status === "SUCCESS") resetCompletedOrder();
  }
  function resetCompletedOrder() {
    // A read of an already completed order must not block the next purchase.
    // Abort it before clearing the order so its late response cannot restore it.
    pending.current?.abort();
    pending.current = null;
    const next = { scope, order: null, creating: false, uncertain: false, message: null };
    latest.current = next;
    setState(next);
  }
  return { ...active, accessError, cancelling, cancel, refresh, create, regenerate, buyAgain, revoke: () => setAccessError("Access denied") };
}
