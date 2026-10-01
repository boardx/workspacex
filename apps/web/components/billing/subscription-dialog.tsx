"use client";
import * as React from "react";
import { useState } from "react";
import { ArrowUpRight, CircleCheck, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { SUBSCRIPTIONS, type PreviewState, type SubscriptionVariant } from "@/lib/mock/billing";

const PRO_BENEFITS = [
  "全部模型与 Agent 能力不限量使用",
  "更长的上下文窗口",
  "优先获得新功能与支持",
] as const;

function PlanStatusBadge({ variant }: { variant: SubscriptionVariant }) {
  if (variant === "free") return null;
  const tone = variant === "canceled" ? "attention" : variant === "trialing" ? "ai" : "primary";
  const label =
    variant === "active" ? "已订阅" : variant === "trialing" ? "试用中" : variant === "canceled" ? "已取消" : "同步中";
  return (
    <Badge tone={tone} data-testid="billing-sub-status">
      {label}
    </Badge>
  );
}

/**
 * 订阅升级 / 管理弹窗（需求 03 R8）：
 * 免费用户 → 升级按钮 + 计划说明；已订阅 → 管理订阅入口 + 订阅状态标识。
 * E5：取消订阅必须把生效时点讲清楚；E2：回跳后同步中不得把已订阅显示为免费。
 */
export function SubscriptionDialog({
  variant,
  state,
  open,
  onOpenChange,
}: {
  variant: SubscriptionVariant;
  state: PreviewState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snap = SUBSCRIPTIONS[variant];
  const [hint, setHint] = useState<string | null>(null);
  const isSubscribed = variant === "active" || variant === "trialing" || variant === "canceled" || variant === "syncing";

  const handleUpgrade = () => {
    setHint("将跳转 Stripe 托管支付页完成订阅（原型不实际跳转）");
  };
  const handleManage = () => {
    setHint("将跳转 Stripe 账单门户（原型不实际跳转）");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="billing-sub-dialog" closeTestId="billing-sub-close" className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-20">{isSubscribed ? "我的订阅" : "升级订阅"}</DialogTitle>
            <PlanStatusBadge variant={variant} />
          </div>
          <DialogDescription>
            订阅状态以 Stripe 通知为准，系统内自动保持同步。
          </DialogDescription>
        </DialogHeader>

        {state === "loading" ? (
          <LoadingSkeleton testid="billing-sub-loading" />
        ) : state === "invalid" ? (
          <ErrorState
            testid="billing-err-sub-config"
            message="订阅渠道未配置，升级入口暂不可用。请联系平台管理员开通 Stripe。"
          />
        ) : state === "depfail" ? (
          <ErrorState
            testid="billing-err-sub-link"
            message="获取支付链接失败，请稍后重试。不会跳转到无效地址。"
          />
        ) : state === "denied" ? (
          <div
            data-testid="billing-sub-denied"
            className="flex flex-col items-center gap-2 rounded-card border border-border px-4 py-10 text-center"
          >
            <ShieldAlert aria-hidden className="h-5 w-5 text-warning" />
            <p className="text-13 text-muted-foreground">请先登录后查看或发起订阅。</p>
          </div>
        ) : (
          <>
            <div
              data-testid="billing-sub-plan"
              className="flex flex-col gap-3 rounded-card border border-border bg-card p-4"
            >
              <div className="flex items-baseline justify-between">
                <p className="text-14 font-medium text-background-foreground">{snap.planLabel} 计划</p>
                <p className="font-mono text-24 font-semibold text-background-foreground">¥49<span className="text-12 font-normal text-muted-foreground">/月</span></p>
              </div>

              {variant === "syncing" ? (
                <div data-testid="billing-sub-syncing" className="flex items-center gap-2 text-12 text-muted-foreground">
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  订阅状态同步中，稍后自动更新。若你刚完成支付，请勿重复购买。
                </div>
              ) : (
                <p className="text-12 text-muted-foreground">
                  {variant === "free"
                    ? "当前：免费版"
                    : variant === "canceled"
                      ? `订阅已取消，将于 ${snap.periodEndLabel} 到期；到期前可继续使用 Pro 能力。`
                      : `当前周期到 ${snap.periodEndLabel}，到期自动续费。`}
                </p>
              )}

              <ul className="flex flex-col gap-1.5">
                {PRO_BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-2 text-13 text-background-foreground">
                    <CircleCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
                    {benefit}
                  </li>
                ))}
              </ul>

              {variant === "canceled" && (
                <p data-testid="billing-sub-cancel-note" className="rounded-control bg-warning-tint px-2.5 py-1.5 text-12 text-warning-tint-foreground">
                  取消在周期结束时生效：{snap.periodEndLabel} 后回到免费版，期间不会再次扣款。
                </p>
              )}

              {variant === "trialing" && (
                <p data-testid="billing-sub-trial-note" className="rounded-control bg-ai-tint px-2.5 py-1.5 text-12 text-ai-tint-foreground">
                  {snap.periodEndLabel}。试用期不产生扣款。
                </p>
              )}
            </div>

            {!isSubscribed ? (
              <Button variant="primary" size="lg" data-testid="billing-upgrade-btn" onClick={handleUpgrade} className="w-full">
                升级到 Pro
                <ArrowUpRight aria-hidden className="h-4 w-4" />
              </Button>
            ) : variant === "canceled" ? (
              <Button variant="primary" size="lg" data-testid="billing-resubscribe-btn" onClick={handleUpgrade} className="w-full">
                重新订阅
              </Button>
            ) : (
              <Button variant="primary" size="lg" data-testid="billing-manage-btn" onClick={handleManage} className="w-full">
                管理订阅
                <ExternalLink aria-hidden className="h-4 w-4" />
              </Button>
            )}

            {hint && (
              <p data-testid="billing-sub-hint" className="text-center text-11 text-muted-foreground">
                {hint}
              </p>
            )}
          </>
        )}

        <p className="text-11 text-muted-foreground">
          支付由 Stripe 托管处理，WorkSpaceX 不接触你的银行卡信息。
        </p>
      </DialogContent>
    </Dialog>
  );
}
