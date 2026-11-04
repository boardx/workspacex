"use client";
import * as React from "react";
import { Zap, TimerReset, ShieldAlert, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminModal } from "./panel";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * 停用某能力的二选一确认（D-U5 裁决 A+）—— 模型停用 / agent 停用 / skill 下线 /
 * MCP 撤销授权四处**共用这一个组件**，不各写一遍。
 *
 * 核心：停用动机分两类——**安全事件**（必须立即断）与**版本下线**（可以跑完）。
 *   只支持一种必然有一种场景很难受，所以把选择权交给按下停用的那个人：
 *     · 立即中断（默认）：进行中的调用失败并提示「该能力已被管理员停用」；
 *     · 允许跑完当前一轮：已发起的调用跑完，新调用被拒。
 *   两个选项都真生效——`onConfirm(mode)` 把选择回传，调用方据此给出不同反馈。
 *   确认弹窗必须说清影响范围：当前有 N 个进行中的调用（N 从 mock 来，不写死 0）。
 */

export type DisableMode = "interrupt" | "drain";

const MODE_META: Record<DisableMode, { label: MessageKey; Icon: typeof Zap; blurb: MessageKey; motive: MessageKey }> = {
  interrupt: {
    label: "disable.interrupt",
    Icon: Zap,
    blurb: "disable.interruptBlurb",
    motive: "disable.interruptMotive",
  },
  drain: {
    label: "disable.drain",
    Icon: TimerReset,
    blurb: "disable.drainBlurb",
    motive: "disable.drainMotive",
  },
};

export function DisableDialog({
  testid, verb, capabilityName, inFlight,
  interruptEffect, drainEffect, onCancel, onConfirm,
}: {
  testid: string;
  /** 动作动词：停用 / 下线 / 撤销授权 */
  verb: string;
  capabilityName: string;
  /** 当前进行中的调用数 N（从 mock 来）*/
  inFlight: number;
  /** 该能力被「立即中断」时，进行中调用具体会怎样（各屏语义不同）*/
  interruptEffect?: string;
  /** 该能力被「允许跑完」时的说明 */
  drainEffect?: string;
  onCancel: () => void;
  onConfirm: (mode: DisableMode) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<DisableMode>("interrupt");
  const [reason, setReason] = React.useState("");
  const canConfirm = reason.trim().length >= 4;
  const active = MODE_META[mode];

  return (
    <AdminModal
      testid={testid}
      title={`${verb} · ${capabilityName}`}
      subtitle={t("disable.subtitle")}
      onClose={onCancel}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid={`${testid}-cancel`}>{t("common.cancel")}</Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => onConfirm(mode)}
            data-testid={`${testid}-confirm`}
            title={canConfirm ? undefined : t("controls.reasonBeforeConfirm")}
          >
            {t("disable.confirm", { mode: t(active.label), verb })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* 影响范围：当前有 N 个进行中的调用（危险动作显式说清代价）*/}
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid={`${testid}-impact`}>
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex min-w-0 flex-col gap-1 text-12">
            <p className="flex flex-wrap items-center gap-1.5">
              {t("disable.impactBefore")}
              <Badge tone="danger" data-testid={`${testid}-inflight`}>{t("disable.impactCount", { count: inFlight })}</Badge>
              {t("disable.impactAfter")}
            </p>
            <p className="text-muted-foreground">
              {mode === "interrupt"
                ? (interruptEffect ?? t("disable.interruptEffect", { count: inFlight }))
                : (drainEffect ?? t("disable.drainEffect", { count: inFlight }))}
            </p>
          </div>
        </div>

        {/* 二选一 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-12 font-medium">{t("disable.choose")}</p>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("disable.mode")}>
            {(Object.keys(MODE_META) as DisableMode[]).map((k) => {
              const m = MODE_META[k];
              const selected = mode === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(k)}
                  data-testid={`${testid}-mode-${k}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary bg-accent/40" : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <m.Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 text-12 font-medium">
                      {t(m.label)}
                      {k === "interrupt" && <span className="text-10 text-muted-foreground">{t("disable.default")}</span>}
                      {selected && <Check aria-hidden className="h-3 w-3 text-primary" />}
                    </span>
                    <span className="text-11 text-muted-foreground">{t(m.blurb)}</span>
                    <span className="text-10 text-muted-foreground">{t(m.motive)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 强制填理由（写审计，与后台其它危险动作一致）*/}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${testid}-reason`} className="text-12 font-medium">{t("controls.auditReason")}</label>
          <textarea
            id={`${testid}-reason`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder={t(mode === "interrupt" ? "disable.interruptPlaceholder" : "disable.drainPlaceholder")}
            data-testid={`${testid}-reason`}
            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-12 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
    </AdminModal>
  );
}
