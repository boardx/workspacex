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
export function billingFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 403) return "你没有此账户的购买权限。";
    const raw = error.raw;
    const code = raw && typeof raw === "object" && "code" in raw ? raw.code : null;
    if (code === "org_billing_disabled") return "组织已关闭购买，请联系组织管理员。";
    if (code === "package_disabled" || code === "package_not_found") return "此套餐已下架，请刷新套餐。";
    if (code === "payment_provider_not_configured") return "微信支付暂未开通。";
  }
  return "暂时无法确认结果，请保留当前页面并联系支持，勿重复付款。";
}
function validateOrder(raw: unknown, owner: CashierOwner, expected?: LiveOrder): LiveOrder {
  const { order } = billing.operations.getPaymentOrder.out.parse(raw);
  if (order.ownerType !== owner.ownerType || order.ownerId !== owner.ownerId || order.provider !== "wechat" || order.currency !== "CNY") throw new Error("ORDER_SCOPE_MISMATCH");
  const qr = new URL(order.qrCodeUrl);
  if (qr.protocol !== "weixin:" || qr.hostname !== "wxpay" || qr.pathname !== "/bizpayurl" || !qr.searchParams.get("pr") || qr.username || qr.password || qr.hash) throw new Error("INVALID_NATIVE_QR");
  if (expected && ["orderNo", "packageId", "amountFen", "baseCredits", "bonusCredits", "currency", "expiredAt", "qrCodeUrl"].some(key => order[key as keyof LiveOrder] !== expected[key as keyof LiveOrder])) throw new Error("ORDER_SNAPSHOT_MISMATCH");
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
  const mounted = React.useRef(true);
  const latest = React.useRef(active); latest.current = active;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  React.useEffect(() => {
    setAccessError(null);
    setState({ scope, order: null, creating: false, uncertain: false, message: null });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [scope]);
  React.useEffect(() => { if (!open) pending.current?.abort(); }, [open]);
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
  async function create(packageId: string) {
    if (pending.current || latest.current.order || latest.current.creating || latest.current.uncertain || !open) return;
    const controller = new AbortController(); pending.current = controller;
    setState({ scope, order: null, creating: true, uncertain: true, message: null });
    try {
      const body = billing.operations.createPaymentOrder.in.parse({ ownerType: owner.ownerType, ...(owner.ownerType === "team" ? { ownerId: owner.ownerId } : {}), packageId, provider: "wechat" });
      const raw = await apiRequest<unknown>(billing.operations.createPaymentOrder.path, { method: "POST", body, sessionToken, signal: controller.signal });
      const order = validateOrder(raw, owner);
      if (order.packageId !== packageId || order.status !== "PENDING") throw new Error("ORDER_CREATE_MISMATCH");
      if (!controller.signal.aborted && mounted.current && currentScope.current === scope) setState({ scope, order, creating: false, uncertain: false, message: null });
    } catch (error) {
      if (mounted.current && currentScope.current === scope) {
        // Only explicit pre-intent client rejections are safe to resubmit. A lost reply is unknown.
        const rejected = error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status);
        setState({ scope, order: null, creating: false, uncertain: !rejected, message: controller.signal.aborted ? "请求已中断，结果待确认。请联系支持，勿重复付款。" : billingFailure(error) });
      }
    } finally { if (pending.current === controller) pending.current = null; }
  }
  function regenerate() {
    if (canRegenerateOrder(latest.current.order) && !pending.current) setState({ scope, order: null, creating: false, uncertain: false, message: null });
  }
  function buyAgain() {
    if (open && !accessError && latest.current.order?.status === "SUCCESS" && !pending.current) setState({ scope, order: null, creating: false, uncertain: false, message: null });
  }
  return { ...active, accessError, refresh, create, regenerate, buyAgain, revoke: () => setAccessError("Access denied") };
}
