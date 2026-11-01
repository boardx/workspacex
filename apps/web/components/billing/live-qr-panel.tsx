"use client";
import * as React from "react";
import QRCode from "qrcode";
import { CircleCheck, Clock3, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canRegenerateOrder, type LiveOrder } from "./use-cashier-order";
export function LiveQrPanel({ order, refresh, regenerate, cancel, cancelling = false }: { order: LiveOrder; refresh: () => void; regenerate: () => void; cancel?: () => void; cancelling?: boolean }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [now, setNow] = React.useState(Date.now);
  const [revision, redraw] = React.useReducer((x: number) => x + 1, 0);
  const [qrFailed, setQrFailed] = React.useState(false);
  const remaining = order.expiredAt===null?0:Math.max(0, Math.ceil((Date.parse(order.expiredAt) - now) / 1000));
  const waiting = order.status === "PENDING";
  const stripe = order.provider === "stripe";
  const visible = !stripe && waiting && remaining > 0 && !cancelling && order.qrCodeUrl!==null;
  const manualClosed = order.status === "CLOSED" && !canRegenerateOrder(order);
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [order.orderNo]);
  React.useEffect(() => {
    if (!visible || !canvas.current || order.qrCodeUrl===null) return;
    let stale = false; setQrFailed(false);
    void QRCode.toCanvas(canvas.current, order.qrCodeUrl, { width: 240, margin: 2, errorCorrectionLevel: "M" }).catch(() => { if (!stale) setQrFailed(true); });
    return () => { stale = true; };
  }, [visible, order.qrCodeUrl, revision]);
  return <section className="min-w-0 space-y-5 self-start rounded-card border border-border bg-muted/30 p-5 sm:p-6" aria-label="微信支付订单">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-14 font-medium">{stripe ? "Stripe 付款" : "微信扫码支付"}</h3><span className="text-20 font-semibold tabular-nums">{new Intl.NumberFormat("zh-CN", { style: "currency", currency: order.currency }).format(order.amountFen / 100)}</span></div>
    {!visible && <div data-testid="billing-qr-placeholder" className="sr-only">当前无可扫描二维码</div>}
    {visible && <div hidden={qrFailed} data-testid="billing-qr-code-area" className="mx-auto w-fit max-w-full rounded-card bg-white p-3"><canvas ref={canvas} className="h-auto max-w-full" role="img" aria-label="微信支付二维码" /></div>}
    {stripe && waiting && remaining > 0 && !cancelling && order.qrCodeUrl!==null && <a className="inline-flex rounded-lg border p-3" href={order.qrCodeUrl} target="_blank" rel="noopener noreferrer">前往 Stripe 付款</a>}
    {order.status === "SUCCESS" && <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-center"><CircleCheck aria-hidden className="h-16 w-16 text-success"/><div role="status" className="space-y-2"><p data-testid="billing-success-badge" className="text-20 font-semibold">支付已确认</p><p data-testid="billing-order-credited" className="text-14 text-muted-foreground">本次到账 {order.baseCredits + order.bonusCredits} 额度</p></div></div>}
    <div className="space-y-3 border-t border-border pt-4"><p data-testid="billing-order-no" className="break-all text-12 leading-relaxed text-muted-foreground">订单号：{order.orderNo}</p>
    <div className="flex items-center gap-2 text-14">{order.status === "SUCCESS" ? <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success"/> : order.status === "FAILED" || manualClosed ? <ShieldAlert aria-hidden className="h-4 w-4 shrink-0 text-destructive"/> : <Clock3 aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground"/>}<p data-testid="billing-order-status">{manualClosed ? "等待人工处理" : ({ PENDING: "待支付", PROCESSING: "确认到账中", SUCCESS: "已到账", CLOSED: "已关闭", FAILED: "到账处理失败" })[order.status]}</p></div></div>
    {qrFailed && <p role="status">二维码暂时无法显示。<Button variant="outline" onClick={redraw}>重新绘制二维码</Button>此操作不会重新下单。</p>}
    {cancelling && <p role="status">正在取消订单，请勿继续扫码付款…</p>}
    {waiting && !cancelling && <>
      <p data-testid="billing-order-countdown" className="text-center text-13 tabular-nums">{remaining > 0 ? `请在 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} 内完成支付` : "二维码已到期，支付结果待确认。请刷新状态，勿重复付款。"}</p>
      {remaining === 0 && <div data-testid="billing-qr-expired" className="rounded-lg bg-muted p-4 text-center text-13">二维码已隐藏，避免误扫。服务器确认关闭后可以重新生成。</div>}
    </>}
    {order.status === "PROCESSING" && <p data-testid="billing-processing-hint" role="status">正在确认到账，请勿重复付款。</p>}
    {order.status === "FAILED" && <p role="alert" className="text-destructive">到账处理失败。款项可能已支付，请联系支持并提供订单号，勿再次付款。</p>}
    {manualClosed && <p data-testid="billing-manual-recovery" role="alert" className="rounded-lg bg-muted p-4 text-13">{order.lastErrorCode === "invalid_amount" ? "支付已收到，额度暂未到账。请联系支持并提供订单号，勿再次付款。" : "订单需要人工核对，请刷新状态或联系支持，勿再次付款。"}</p>}
    {canRegenerateOrder(order) && <div className="space-y-2"><p role="status">订单已关闭。如已扣款，请先刷新状态或联系支持，勿重复付款。</p><Button data-testid="billing-regenerate" variant="outline" onClick={regenerate}>选择套餐重新生成</Button></div>}
    <div className="flex flex-col gap-2"><Button className="w-full" size="lg" data-testid="billing-refresh-status" disabled={cancelling} variant="outline" onClick={refresh}><RefreshCw aria-hidden className="mr-1 h-4 w-4"/>刷新支付状态</Button>
    {waiting && cancel && <Button className="w-full" data-testid="billing-cancel-order" disabled={cancelling} variant="ghost" onClick={cancel}>{cancelling ? "正在取消…" : "取消订单"}</Button>}</div>
  </section>;
}
