"use client";
import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AdminConsole } from "@/components/billing/admin-console";
import { CashierDialog } from "@/components/billing/cashier-dialog";
import { MenuEntriesPreview } from "@/components/billing/menu-entries-preview";
import { OrgBillingSection } from "@/components/billing/org-billing-section";
import { SubscriptionDialog } from "@/components/billing/subscription-dialog";
import {
  ORDER_STAGES,
  PREVIEW_STATES,
  ROLES,
  SUBJECTS,
  SUB_VARIANTS,
  type OrderStage,
  type PreviewRole,
  type PreviewState,
  type PurchaseSubject,
  type SubscriptionVariant,
} from "@/lib/mock/billing";
import { cn } from "@/lib/utils";

type BillingScreen = "cashier" | "subscription" | "admin" | "org-billing" | "menu";

const SCREENS: readonly { key: BillingScreen; label: string }[] = [
  { key: "cashier", label: "收银台" },
  { key: "subscription", label: "订阅弹窗" },
  { key: "admin", label: "计费管理端" },
  { key: "org-billing", label: "组织计费" },
  { key: "menu", label: "用户菜单入口" },
];

function setParam(key: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.location.href = url.toString();
}

function BarButton({
  testId,
  active,
  label,
  onClick,
  accent,
}: {
  testId: string;
  active: boolean;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "rounded-control px-2 py-0.5 text-11 transition-colors duration-fast hover:bg-muted",
        active ? (accent ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground") : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <span className="text-10 uppercase tracking-wide text-muted-foreground">{children}</span>;
}

/** 弹窗背后示意三栏骨架（硬规则 ⑥：三栏是已确认产品心智；此处仅作背景幕，aria-hidden） */
function AppBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1">
      <div aria-hidden className="absolute inset-0 flex">
        <div className="w-14 border-r border-border bg-rail" />
        <div className="flex flex-1 flex-col">
          <div className="h-10 border-b border-border bg-card" />
          <div className="grid min-h-0 flex-1 grid-cols-[224px,1fr,264px]">
            <div className="border-r border-border bg-panel" />
            <div className="bg-background" />
            <div className="border-l border-border bg-panel-alt" />
          </div>
        </div>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function DialogBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <AppBackdrop>
      <div className="flex h-[calc(100vh-96px)] items-center justify-center p-4">{children}</div>
    </AppBackdrop>
  );
}

export function BillingPreview({
  screen,
  state,
  stage,
  subject,
  role,
  sub,
  billingEnabled,
  grantStage,
}: {
  screen: BillingScreen;
  state: PreviewState;
  stage: OrderStage;
  subject: PurchaseSubject;
  role: PreviewRole;
  sub: SubscriptionVariant;
  billingEnabled: boolean;
  grantStage: "idle" | "confirm" | "done";
}) {
  const [cashierOpen, setCashierOpen] = useState(true);
  const [subOpen, setSubOpen] = useState(true);

  const openCashier = (nextSubject: PurchaseSubject) => {
    setParam("screen", "cashier");
    setParam("subject", nextSubject);
  };

  const stageRowVisible = screen === "cashier";

  return (
    <div data-testid="billing-preview-host" className="flex h-screen flex-col bg-background text-background-foreground">
      {/* 调试面板：切屏 / 切态 / 切订单态 / 切主体 / 切视角（预览手段，不是权限实现） */}
      <div className="flex flex-col gap-1.5 border-b border-border bg-card px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <GroupLabel>屏</GroupLabel>
          {SCREENS.map((s) => (
            <BarButton
              key={s.key}
              testId={`billing-preview-screen-${s.key}`}
              active={screen === s.key}
              label={s.label}
              onClick={() => setParam("screen", s.key)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <GroupLabel>态</GroupLabel>
          {PREVIEW_STATES.map((s) => (
            <BarButton
              key={s.key}
              testId={`billing-preview-state-${s.key}`}
              active={state === s.key}
              label={s.label}
              onClick={() => setParam("state", s.key)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {stageRowVisible && (
            <>
              <GroupLabel>订单态</GroupLabel>
              {ORDER_STAGES.map((s) => (
                <BarButton
                  key={s.key}
                  testId={`billing-preview-stage-${s.key}`}
                  active={stage === s.key}
                  label={s.label}
                  accent
                  onClick={() => setParam("stage", s.key)}
                />
              ))}
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          <GroupLabel>主体</GroupLabel>
          {SUBJECTS.map((s) => (
            <BarButton
              key={s.key}
              testId={`billing-preview-subject-${s.key}`}
              active={subject === s.key}
              label={s.label}
              onClick={() => setParam("subject", s.key)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <GroupLabel>视角</GroupLabel>
          {ROLES.map((r) => (
            <BarButton
              key={r.key}
              testId={`billing-preview-role-${r.key}`}
              active={role === r.key}
              label={r.label}
              accent
              onClick={() => setParam("role", r.key)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <GroupLabel>订阅</GroupLabel>
          {SUB_VARIANTS.map((s) => (
            <BarButton
              key={s.key}
              testId={`billing-preview-sub-${s.key}`}
              active={sub === s.key}
              label={s.label}
              onClick={() => setParam("sub", s.key)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {screen === "cashier" &&
          (cashierOpen ? (
            <DialogBackdrop>
              <CashierDialog
                subject={subject}
                state={state}
                stage={stage}
                open
                onOpenChange={(next) => {
                  if (!next) setCashierOpen(false);
                }}
              />
            </DialogBackdrop>
          ) : (
            <DialogBackdrop>
              <Button variant="outline" data-testid="billing-reopen-cashier" onClick={() => setCashierOpen(true)}>
                重新打开收银台
              </Button>
            </DialogBackdrop>
          ))}

        {screen === "subscription" &&
          (subOpen ? (
            <DialogBackdrop>
              <SubscriptionDialog variant={sub} state={state} open onOpenChange={(next) => setSubOpen(next)} />
            </DialogBackdrop>
          ) : (
            <DialogBackdrop>
              <Button variant="outline" data-testid="billing-reopen-sub" onClick={() => setSubOpen(true)}>
                重新打开订阅弹窗
              </Button>
            </DialogBackdrop>
          ))}

        {screen === "admin" && (
          <AdminConsole state={role === "platform-admin" ? state : "denied"} grantStage={grantStage} />
        )}

        {screen === "org-billing" && (
          <OrgBillingSection
            state={role === "user" ? "denied" : state}
            billingEnabled={billingEnabled}
            onOpenCashier={() => openCashier("org")}
          />
        )}

        {screen === "menu" && (
          <MenuEntriesPreview
            variant={sub}
            onOpenCashier={() => openCashier("personal")}
            onOpenSubscription={() => setParam("screen", "subscription")}
          />
        )}
      </div>
    </div>
  );
}
