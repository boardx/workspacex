"use client";
import * as React from "react";
import { useState } from "react";
import { CreditCard, QrCode, ShieldAlert, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrPanel } from "@/components/billing/qr-panel";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { cn } from "@/lib/utils";
import {
  CREDIT_PACKAGES,
  LEDGER_SOURCE_LABEL,
  LEDGER_TYPE_LABEL,
  ORG_WALLET,
  PERSONAL_LEDGER,
  PERSONAL_WALLET,
  fenToYuan,
  formatCredits,
  type CreditLedgerEntry,
  type OrderStage,
  type PreviewState,
  type PurchaseSubject,
} from "@/lib/mock/billing";

/** 最近流水可见行数（与参考实现一致：收银台内嵌少量最近记录，完整列表在流水入口） */
const RECENT_LEDGER_ROWS = 5;

function RecentLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
  return (
    <div
      data-testid={`billing-recent-ledger-row-${entry.id}`}
      className="grid grid-cols-[88px,1fr,96px] items-baseline gap-2 px-3 py-1.5 text-12"
    >
      <span className="text-background-foreground">{LEDGER_TYPE_LABEL[entry.type]}</span>
      <span className="truncate text-muted-foreground">
        {entry.type === "grant" && entry.reason ? `${entry.description} · ${entry.reason}` : entry.description}
        <span className="ml-2 text-11">({LEDGER_SOURCE_LABEL[entry.source]})</span>
      </span>
      <span className="text-right font-mono font-medium text-success">+{formatCredits(entry.credits)}</span>
    </div>
  );
}

/**
 * 收银台弹窗（需求 01 R8 全构成）：套餐卡片（选中态）→ 支付方式 → 生成二维码 →
 * 二维码展示区 → 状态提示区 → 刷新支付状态。主体为个人 / 组织（需求 01 R2/R5）。
 *
 * 金额与额度只来自套餐 mock（生产由服务端决定，前端不上传任何金额字段，R7.1）。
 */
export function CashierDialog({
  subject,
  state,
  stage,
  open,
  onOpenChange,
}: {
  subject: PurchaseSubject;
  state: PreviewState;
  stage: OrderStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState<string>(CREDIT_PACKAGES[0]?.id ?? "");
  // 本地下单态：点「生成二维码」进入 pending；state/stage 由预览条控制时覆盖之。
  const [localStage, setLocalStage] = useState<OrderStage>(stage);
  const [isGenerating, setIsGenerating] = useState(false);

  const wallet = subject === "org" ? ORG_WALLET : PERSONAL_WALLET;
  const selected = CREDIT_PACKAGES.find((p) => p.id === selectedPackageId) ?? null;

  const title = subject === "org" ? "为组织购买额度" : "购买额度";
  const titleHint =
    subject === "org" ? "额度入组织钱包，组织 owner/admin 可查流水" : "额度入个人钱包，可随时在流水入口查询";

  // 与预览条切换保持同步（URL query 变化时重置本地态）
  React.useEffect(() => {
    setLocalStage(stage);
  }, [stage, state]);

  const effectiveStage: OrderStage =
    state === "default" ? localStage : state === "success" ? "success" : "default";

  const handleGenerate = () => {
    if (!selected) return;
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setLocalStage("pending");
    }, 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="billing-cashier-dialog"
        closeTestId="billing-cashier-close"
        className="max-w-2xl"
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-20">{title}</DialogTitle>
            {state !== "denied" && (
              <div className="flex items-center gap-2">
                {subject === "org" && <Badge tone="ai">组织钱包</Badge>}
                <div className="text-right">
                  <p className="text-10 text-muted-foreground">当前余额</p>
                  <p data-testid="billing-cashier-balance" className="font-mono text-16 font-semibold text-background-foreground">
                    {formatCredits(wallet.balance)}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogDescription>{titleHint}</DialogDescription>
        </DialogHeader>

        {state === "denied" ? (
          <div
            data-testid="billing-cashier-denied"
            className="flex flex-col items-center gap-2 rounded-card border border-border px-4 py-12 text-center"
          >
            <ShieldAlert aria-hidden className="h-5 w-5 text-warning" />
            <p className="text-13 font-medium text-background-foreground">没有购买权限</p>
            <p className="max-w-80 text-12 text-muted-foreground">
              {subject === "org"
                ? "仅组织 owner / admin 可以为组织购买额度。请切换身份或联系组织管理员。"
                : "请先登录后再购买额度。"}
            </p>
            <p className="text-11 text-muted-foreground">（原型预览：真实权限由服务端判定，前端仅投影入口可见性）</p>
          </div>
        ) : (
        <div className="grid gap-4 md:grid-cols-[1fr,260px]">
          {/* 左列：套餐 + 支付方式 + 主按钮 */}
          <div className="flex flex-col gap-3">
            {state === "loading" ? (
              <LoadingSkeleton testid="billing-cashier-loading" />
            ) : state === "empty" ? (
              <EmptyState
                testid="billing-cashier-empty"
                message="暂无可购买的额度套餐，请稍后再来看看。"
              />
            ) : (
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="选择额度套餐">
                {CREDIT_PACKAGES.map((pkg) => {
                  const isSelected = pkg.id === selectedPackageId;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-testid={`billing-package-${pkg.id}`}
                      onClick={() => setSelectedPackageId(pkg.id)}
                      className={cn(
                        "flex flex-col gap-1 rounded-card border p-3 text-left transition-all duration-fast",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-transparent bg-accent ring-2 ring-ring"
                          : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <span className="text-12 font-medium text-background-foreground">{pkg.name}</span>
                      <span className="font-mono text-20 font-semibold text-background-foreground">
                        {formatCredits(pkg.baseCredits)}
                      </span>
                      <span className="text-10 text-muted-foreground">基础额度</span>
                      <span className="mt-1 font-mono text-14 font-medium text-background-foreground">
                        {pkg.priceLabel}
                      </span>
                      {pkg.bonusCredits > 0 ? (
                        <span className="mt-1 flex items-center gap-1">
                          <Badge tone="success" data-testid={`billing-package-bonus-${pkg.id}`}>
                            赠 {formatCredits(pkg.bonusCredits)}
                          </Badge>
                          <span className="text-10 text-muted-foreground">
                            （{Math.round(pkg.bonusRate * 100)}%）
                          </span>
                        </span>
                      ) : (
                        <span className="mt-1 text-10 text-muted-foreground">无赠送</span>
                      )}
                      <span className="mt-1 border-t border-border-subtle pt-1 text-10 text-muted-foreground">
                        合计 {formatCredits(pkg.totalCredits)} 额度
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 支付方式：微信可用；支付宝未启用（需求 01 R3.2：未启用渠道置灰不可点） */}
            <div className="flex flex-col gap-1.5">
              <p className="text-11 font-medium text-muted-foreground">支付方式</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="billing-provider-wechat"
                  aria-pressed
                  className="flex items-center gap-2 rounded-card border border-transparent bg-accent px-3 py-2 text-left transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Smartphone aria-hidden className="h-4 w-4 text-accent-foreground" />
                  <span className="text-12 font-medium text-accent-foreground">微信扫码支付</span>
                </button>
                <button
                  type="button"
                  disabled
                  data-testid="billing-provider-alipay"
                  className="flex items-center gap-2 rounded-card border border-border bg-card px-3 py-2 text-left disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
                >
                  <CreditCard aria-hidden className="h-4 w-4" />
                  <span className="text-12">支付宝（未开通）</span>
                </button>
              </div>
            </div>

            {/* E1 渠道未配置：入口明确报错，不展示扫不成功的二维码（需求 01 E1） */}
            {state === "invalid" && (
              <ErrorState
                testid="billing-err-provider"
                message="微信扫码渠道未配置（PAYMENT_PROVIDER_NOT_CONFIGURED），暂时无法创建订单。请联系平台管理员开通。"
              />
            )}

            {/* E2 微信下单失败：可重试的失败提示，订单不进入持有假二维码的状态（需求 01 E2） */}
            {state === "depfail" && (
              <ErrorState
                testid="billing-err-create"
                message="向微信下单失败，尚未生成可支付的二维码。请稍后重试。"
                onRetry={() => undefined}
              />
            )}

            <Button
              variant="primary"
              size="lg"
              data-testid="billing-generate-qr"
              onClick={handleGenerate}
              disabled={
                !selected || isGenerating || state === "loading" || state === "empty" || state === "invalid"
              }
            >
              <QrCode aria-hidden className="h-4 w-4" />
              {isGenerating ? "正在创建订单…" : "生成二维码"}
            </Button>
          </div>

          {/* 右列：二维码 + 订单状态区（状态语义由 QrPanel 负责） */}
          {state === "loading" ? (
            <LoadingSkeleton testid="billing-qr-loading" />
          ) : (
            <QrPanel stage={effectiveStage} onRegenerate={() => setLocalStage("pending")} />
          )}
        </div>
        )}

        {/* 最近流水（需求 01 R3.7/R3.8：余额与本次充值记录随时可查）；denied 不泄露流水 */}
        {state !== "denied" && (
        <div className="rounded-card border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-12 font-medium text-background-foreground">最近流水</p>
            <Button variant="ghost" size="xs" data-testid="billing-view-all-ledger">
              查看全部
            </Button>
          </div>
          <div data-testid="billing-recent-ledger" className="divide-y divide-border-subtle py-1">
            {PERSONAL_LEDGER.slice(0, RECENT_LEDGER_ROWS).map((entry) => (
              <RecentLedgerRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
        )}

        {state !== "denied" && (
          <p className="text-11 text-muted-foreground">
            金额与额度以服务端套餐为准；到账以微信服务端回调为准（{fenToYuan(selected?.priceFen ?? 0)} 元起）。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
