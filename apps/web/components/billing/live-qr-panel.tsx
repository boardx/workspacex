"use client";
import * as React from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import type { LiveOrder } from "./use-cashier-order";
export function LiveQrPanel({ order, refresh, regenerate }: { order: LiveOrder; refresh: () => void; regenerate: () => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [now, setNow] = React.useState(Date.now);
  const [qrFailed, setQrFailed] = React.useState(false);
  const remaining = Math.max(0, Math.ceil((Date.parse(order.expiredAt) - now) / 1000));
  const waiting = order.status === "PENDING" || order.status === "PROCESSING";
  const visible = waiting && remaining > 0;
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [order.orderNo]);
  React.useEffect(() => {
    if (!visible || !canvas.current) return;
    let stale = false; setQrFailed(false);
    void QRCode.toCanvas(canvas.current, order.qrCodeUrl, { width: 208, margin: 2, errorCorrectionLevel: "M" }).catch(() => { if (!stale) setQrFailed(true); });
    return () => { stale = true; };
  }, [visible, order.qrCodeUrl]);
  return <section className="space-y-4 rounded-lg border p-4" aria-label="微信支付订单">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">微信扫码支付</h3><span className="text-20 font-semibold tabular-nums">{new Intl.NumberFormat("zh-CN", { style: "currency", currency: order.currency }).format(order.amountFen / 100)}</span></div>
    <p className="break-all text-12 text-muted-foreground">订单号：{order.orderNo}</p>
    {visible && !qrFailed && <div data-testid="billing-qr-code-area" className="mx-auto w-fit rounded-lg bg-white p-2"><canvas ref={canvas} role="img" aria-label="微信支付二维码" /></div>}
    {qrFailed && <p role="status">二维码暂时无法显示，请保留订单并联系支持，勿重复付款。</p>}
    {waiting && <>
      <p data-testid="billing-order-countdown" className="text-center text-13 tabular-nums">{remaining > 0 ? `请在 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} 内完成支付` : "二维码已到期，支付结果待确认。请刷新状态，勿重复付款。"}</p>
      {remaining === 0 && <div data-testid="billing-qr-expired" className="rounded-lg bg-muted p-4 text-center text-13">二维码已隐藏，避免误扫。服务器确认关闭后可以重新生成。</div>}
    </>}
    {order.status === "SUCCESS" && <div role="status" className="space-y-2"><p data-testid="billing-success-badge" className="font-semibold text-primary">支付已确认</p><p data-testid="billing-order-credited">本次到账 {order.baseCredits + order.bonusCredits} 额度</p></div>}
    {order.status === "FAILED" && <p role="alert" className="text-destructive">到账处理失败。款项可能已支付，请联系支持并提供订单号，勿再次付款。</p>}
    {order.status === "CLOSED" && <div className="space-y-2"><p role="status">订单已关闭。如已扣款，请先刷新状态或联系支持，勿重复付款。</p><Button data-testid="billing-regenerate" variant="outline" onClick={regenerate}>选择套餐重新生成</Button></div>}
    <Button data-testid="billing-refresh-status" variant="outline" onClick={refresh}>刷新支付状态</Button>
  </section>;
}
