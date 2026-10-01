"use client";
import * as React from "react";
import { useState } from "react";
import { Building2, CircleCheck, QrCode, ShieldAlert, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import {
  LEDGER_SOURCE_LABEL,
  LEDGER_TYPE_LABEL,
  ORG_LEDGER,
  ORG_WALLET,
  formatCredits,
  type PreviewState,
} from "@/lib/mock/billing";

/**
 * 组织计费设置区块（组织 owner/admin 视角，需求 04 R3.4/R8）：
 * 组织钱包余额 + 「为组织购买」入口 + 组织计费开关键。
 * 关闭只影响**新购买入口**，已购余额仍可查看、不追缴（R3.4）。
 */
export function OrgBillingSection({
  state,
  billingEnabled,
  onOpenCashier,
}: {
  state: PreviewState;
  billingEnabled: boolean;
  onOpenCashier: () => void;
}) {
  const [enabled, setEnabled] = useState(billingEnabled);
  const [savedHint, setSavedHint] = useState(false);

  React.useEffect(() => {
    setEnabled(billingEnabled);
  }, [billingEnabled]);

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    setSavedHint(true);
    window.setTimeout(() => setSavedHint(false), 2400);
  };

  if (state === "denied") {
    return (
      <div data-testid="billing-org-denied" className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert aria-hidden className="h-6 w-6 text-warning" />
        <p className="text-14 font-medium text-background-foreground">组织计费仅 owner / admin 可见</p>
        <p className="text-12 text-muted-foreground">普通成员看不到组织钱包与购买入口。</p>
      </div>
    );
  }

  return (
    <div data-testid="billing-org-host" className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Building2 aria-hidden className="h-4 w-4 text-accent-foreground" />
        <h1 className="text-20 font-bold tracking-tight text-background-foreground">深潜工作室 · 组织计费</h1>
      </div>

      {state === "loading" ? (
        <LoadingSkeleton testid="billing-org-loading" />
      ) : state === "depfail" ? (
        <ErrorState
          testid="billing-org-error"
          message="组织钱包读取失败，请稍后重试。"
          onRetry={() => undefined}
        />
      ) : (
        <>
          {/* 组织钱包余额 */}
          <div
            data-testid="billing-org-wallet"
            className="grid grid-cols-2 gap-3 rounded-card border border-border bg-card p-4 md:grid-cols-3"
          >
            <div>
              <p className="flex items-center gap-1.5 text-11 text-muted-foreground">
                <Wallet aria-hidden className="h-3.5 w-3.5" />
                组织余额
              </p>
              <p data-testid="billing-org-balance" className="mt-1 font-mono text-24 font-semibold text-background-foreground">
                {formatCredits(ORG_WALLET.balance)}
              </p>
            </div>
            <div>
              <p className="text-11 text-muted-foreground">累计获得</p>
              <p className="mt-1 font-mono text-24 font-semibold text-background-foreground">
                {formatCredits(ORG_WALLET.totalAcquired)}
              </p>
            </div>
            <div className="col-span-2 md:col-span-1">
              <p className="text-11 text-muted-foreground">组织计费</p>
              <div className="mt-1 flex items-center gap-2">
                <Toggle
                  checked={enabled}
                  onCheckedChange={handleToggle}
                  label="组织计费开关"
                  data-testid="billing-org-billing-toggle"
                />
                <span className="text-12 font-medium text-background-foreground">
                  {enabled ? "已开启" : "已关闭"}
                </span>
                {savedHint && (
                  <span data-testid="billing-org-toggle-saved" className="flex items-center gap-1 text-11 text-success">
                    <CircleCheck aria-hidden className="h-3 w-3" />
                    已保存
                  </span>
                )}
              </div>
              <p className="mt-1 text-11 text-muted-foreground">
                {enabled
                  ? "组织成员可使用组织额度购买入口。"
                  : "新购买入口不可用；已购余额仍可查看，不受影响。"}
              </p>
            </div>
          </div>

          {/* 为组织购买入口（关闭计费后禁用，需求 04 R3.4：只影响新购买入口） */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4">
            <div>
              <p className="text-13 font-medium text-background-foreground">为组织购买额度</p>
              <p className="mt-0.5 text-12 text-muted-foreground">额度入组织钱包，组织 owner / admin 可查流水。</p>
            </div>
            <Button
              variant="primary"
              data-testid="billing-org-purchase-btn"
              onClick={onOpenCashier}
              disabled={!enabled}
            >
              <QrCode aria-hidden className="h-4 w-4" />
              为组织购买
            </Button>
          </div>
          {!enabled && (
            <p data-testid="billing-org-billing-off-note" className="rounded-control bg-warning-tint px-3 py-2 text-12 text-warning-tint-foreground">
              组织计费已关闭：新购买入口不可用。开启后可重新购买；已购余额不受影响。
            </p>
          )}

          {/* 组织最近流水 */}
          <div className="rounded-card border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-13 font-medium text-background-foreground">组织流水</p>
              <Badge tone="neutral">近 6 条</Badge>
            </div>
            <div data-testid="billing-org-ledger" className="divide-y divide-border-subtle">
              {ORG_LEDGER.slice(0, 6).map((entry) => (
                <div key={entry.id} className="grid grid-cols-[80px,1fr,110px,120px] items-baseline gap-3 px-4 py-2 text-12">
                  <span className="font-medium text-background-foreground">{LEDGER_TYPE_LABEL[entry.type]}</span>
                  <span className="truncate text-muted-foreground">
                    {entry.reason ? `${entry.description} · ${entry.reason}` : entry.description}
                    <span className="ml-2 text-11">({LEDGER_SOURCE_LABEL[entry.source]})</span>
                  </span>
                  <span className="text-right font-mono text-12 text-success">+{formatCredits(entry.credits)}</span>
                  <span className="text-right font-mono text-11 text-muted-foreground">{entry.createdAt}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
