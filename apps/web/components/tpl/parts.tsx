"use client";
import * as React from "react";
import { AlertTriangle, Sparkles, Info, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** AI 产出角标 —— 与人工内容视觉区分（uc-2-1/2-2 R7：机器产出必须标识 + 挂来源）*/
export function AiTag({ sources, className }: { sources?: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} data-testid="tpl-ai-tag">
      <Badge tone="ai"><Sparkles aria-hidden className="h-2.5 w-2.5" /> AI 产出</Badge>
      {sources && sources.length > 0 && (
        <span className="text-11 text-muted-foreground">来源：{sources.join(" · ")}</span>
      )}
    </span>
  );
}

/**
 * sign-off 状态旗标 —— 把「未探明 / 确认缺失 / 待补抽取」直接画到屏上（ADR-003 的用意）。
 * 三态含义不同（PROTOTYPE-DIGEST「要分清要补什么」）：
 *   unexplored = 原型很可能有、只是没点进去（不要重画，先补抽取）
 *   confirmed-missing = 已探明区确认缺失（这才是要补画的）
 *   backlog-conflict = 与运行态原型直接冲突（sign-off 必须先裁）
 */
export function SignoffFlag({
  kind, title, children, testid,
}: {
  kind: "unexplored" | "confirmed-missing" | "backlog-conflict" | "note";
  title: string;
  children?: React.ReactNode;
  testid?: string;
}) {
  const meta = {
    unexplored: { label: "未探明", tone: "warning" as const, icon: Info },
    "confirmed-missing": { label: "确认缺失 · 补画", tone: "primary" as const, icon: AlertTriangle },
    "backlog-conflict": { label: "与原型冲突 · 待裁", tone: "danger" as const, icon: ShieldAlert },
    note: { label: "设计判断", tone: "outline" as const, icon: Info },
  }[kind];
  const Icon = meta.icon;
  return (
    <div
      data-testid={testid ?? "tpl-signoff-flag"}
      className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-panel-alt p-3"
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-12 font-medium">{title}</span>
        <Badge tone={meta.tone} className="ml-auto">{meta.label}</Badge>
      </div>
      {children && <div className="text-11 leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * 危险动作二次确认 —— 删除/发布/合并/归档/换模板/回滚都走这里（uc R7：显式 + 影响范围）。
 * 不做成孤零零红按钮；列出影响范围，可选「填理由 ≥N 字才解锁」。
 */
export function ConfirmDialog({
  open, title, tone = "destructive", impact, requireReason, reasonMinLen = 4,
  confirmLabel, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  tone?: "destructive" | "primary";
  impact: React.ReactNode;
  requireReason?: boolean;
  reasonMinLen?: number;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  if (!open) return null;
  const canConfirm = !requireReason || reason.trim().length >= reasonMinLen;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" data-testid="tpl-confirm-overlay">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg" data-testid="tpl-confirm-dialog">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "destructive" ? "text-destructive" : "text-warning")} />
          <div className="flex flex-1 flex-col gap-0.5">
            <h3 className="text-14 font-semibold">{title}</h3>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭" data-testid="tpl-confirm-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="rounded-md border border-border bg-panel p-3 text-12 leading-relaxed" data-testid="tpl-confirm-impact">
          {impact}
        </div>
        {requireReason && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-confirm-reason">原因（≥{reasonMinLen} 字才可确认）</Label>
            <Input
              id="tpl-confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="写清楚为什么，将进审计"
              data-testid="tpl-confirm-reason"
            />
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="tpl-confirm-cancel">取消</Button>
          <Button
            size="sm"
            variant={tone === "destructive" ? "destructive" : "primary"}
            disabled={!canConfirm}
            onClick={() => { onConfirm(); setReason(""); }}
            data-testid="tpl-confirm-ok"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
