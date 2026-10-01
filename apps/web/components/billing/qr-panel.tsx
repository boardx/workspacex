"use client";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CircleCheck, CircleX, Clock3, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  EXPIRED_ORDER,
  FAILED_ORDER,
  PENDING_ORDER,
  SUCCESS_ORDER,
  fenToYuan,
  formatCredits,
  type OrderStage,
  type PaymentOrder,
} from "@/lib/mock/billing";

const ORDER_BY_STAGE: Record<OrderStage, PaymentOrder | null> = {
  default: null,
  pending: PENDING_ORDER,
  success: SUCCESS_ORDER,
  expired: EXPIRED_ORDER,
  failed: FAILED_ORDER,
};

/** 倒计时初始值（秒）：mock 订单剩余约 14 分钟（需求 01 R3.3 有效期 15 分钟） */
const COUNTDOWN_START_SECONDS = 872;

function StatusBanner({ stage }: { stage: OrderStage }) {
  if (stage === "pending") {
    return (
      <div
        data-testid="billing-order-status"
        className="flex items-center gap-2 rounded-card border border-border bg-card px-3 py-2"
      >
        <Clock3 aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="text-12 text-background-foreground">请用微信扫码支付</p>
      </div>
    );
  }
  if (stage === "success") {
    return (
      <div
        data-testid="billing-order-status"
        className="flex items-center gap-2 rounded-card bg-success px-3 py-2 text-success-foreground"
      >
        <CircleCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <p className="text-12 font-medium">支付成功，额度已到账</p>
      </div>
    );
  }
  if (stage === "expired") {
    return (
      <div
        data-testid="billing-order-status"
        className="flex items-center gap-2 rounded-card border border-border bg-warning-tint px-3 py-2 text-warning-tint-foreground"
      >
        <Clock3 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <p className="text-12 font-medium">二维码已过期（15 分钟内未支付，订单已自动关闭）</p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-testid="billing-order-status"
      className="flex items-start gap-2 rounded-card border border-destructive/40 bg-destructive/5 px-3 py-2"
    >
      <CircleX aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
      <p className="text-12 text-destructive">{FAILED_ORDER.failureReason}</p>
    </div>
  );
}

/**
 * 收银台右侧二维码面板：二维码本地渲染 + 订单号（mono）+ 状态横幅 + 倒计时。
 * 状态语义：过期 ≠ 错误（warning-tint + 重新生成）；失败 = destructive + 原因 + 重试。
 */
export function QrPanel({
  stage,
  onRegenerate,
}: {
  stage: OrderStage;
  onRegenerate: () => void;
}) {
  const order = ORDER_BY_STAGE[stage];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [remaining, setRemaining] = useState(COUNTDOWN_START_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshHint, setRefreshHint] = useState<string | null>(null);

  // 二维码本地渲染（需求 01 R3.4：不依赖第三方二维码图床）
  useEffect(() => {
    if (!order || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, order.qrCodeUrl, { width: 168, margin: 1 }, (err) => {
      if (err) {
        // 渲染失败只影响展示，不改变订单状态（原型内提示即可）
        canvasRef.current?.replaceWith("二维码渲染失败，请点击刷新");
      }
    });
  }, [order]);

  // 待支付倒计时（每秒；到期后由服务端关单，前端只做展示——需求 01 R3.3）
  useEffect(() => {
    if (stage !== "pending") return;
    setRemaining(COUNTDOWN_START_SECONDS);
    const timer = window.setInterval(() => {
      setRemaining((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  if (!order) {
    return (
      <div
        data-testid="billing-qr-placeholder"
        className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-card px-4 text-center"
      >
        <p className="text-13 text-background-foreground">选择套餐后生成二维码</p>
        <p className="text-11 text-muted-foreground">订单金额与额度以服务端套餐为准</p>
      </div>
    );
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const countdownLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const codeCovered = stage === "expired" || stage === "failed" || stage === "success";

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshHint(null);
    window.setTimeout(() => {
      setRefreshing(false);
      if (stage === "pending") setRefreshHint("订单尚未支付，请完成扫码后再试");
    }, 800);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="billing-qr-code-area"
        className={cn(
          "relative flex items-center justify-center rounded-card border border-border bg-card p-3",
          codeCovered && "overflow-hidden",
        )}
      >
        <canvas ref={canvasRef} aria-label="微信支付二维码（原型 mock 内容）" />
        {codeCovered && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 p-4 text-center backdrop-blur-sm">
            {stage === "success" && (
              <>
                <CircleCheck aria-hidden className="h-5 w-5 text-success" />
                <p className="text-12 text-background-foreground">本单已完成支付，二维码已失效</p>
              </>
            )}
            {stage === "expired" && (
              <>
                <Clock3 aria-hidden className="h-5 w-5 text-warning" />
                <p className="text-12 text-background-foreground">二维码已过期，请重新生成</p>
              </>
            )}
            {stage === "failed" && (
              <>
                <CircleX aria-hidden className="h-5 w-5 text-destructive" />
                <p className="text-12 text-background-foreground">本单已失败，二维码不再可用</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-card border border-border bg-muted px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-11 text-muted-foreground">订单号</span>
          <span data-testid="billing-order-no" className="font-mono text-11 text-background-foreground">
            {order.orderNo}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-11 text-muted-foreground">金额</span>
          <span className="font-mono text-13 font-medium text-background-foreground">
            ¥{fenToYuan(order.amountFen)}
          </span>
        </div>
        {stage === "pending" && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-11 text-muted-foreground">剩余有效时间</span>
            <span data-testid="billing-order-countdown" className="font-mono text-13 font-medium text-warning">
              {countdownLabel}
            </span>
          </div>
        )}
        {stage === "success" && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-11 text-muted-foreground">本次到账</span>
            <span data-testid="billing-order-credited" className="font-mono text-13 font-medium text-success">
              +{formatCredits(order.baseCredits + order.bonusCredits)}
            </span>
          </div>
        )}
      </div>

      <StatusBanner stage={stage} />

      {stage === "pending" && (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="billing-refresh-status"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full"
          >
            <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "刷新中…" : "刷新支付状态"}
          </Button>
          {refreshHint && (
            <p data-testid="billing-refresh-hint" className="text-center text-11 text-muted-foreground">
              {refreshHint}
            </p>
          )}
          <p className="text-center text-11 text-muted-foreground">
            每 3 秒自动查询一次订单状态
          </p>
        </div>
      )}

      {(stage === "expired" || stage === "failed") && (
        <Button variant="primary" size="sm" data-testid="billing-regenerate" onClick={onRegenerate} className="w-full">
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          重新生成二维码
        </Button>
      )}

      {stage === "success" && (
        <Badge tone="success" data-testid="billing-success-badge" className="justify-center py-1">
          余额与流水已同步更新
        </Badge>
      )}
    </div>
  );
}
