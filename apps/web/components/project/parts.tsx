"use client";
import * as React from "react";
import { Lock, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * project 域共享小件 —— 只做视觉，不含业务逻辑。
 * 一律用设计 token（bg / text / border 前缀）与字号档位（text-9..text-18），不写死 hex/px。
 */

export function SectionTitle({
  children, meta, className,
}: { children: React.ReactNode; meta?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-baseline gap-2.5", className)}>
      <h3 className="text-13 font-semibold tracking-tight">{children}</h3>
      {meta != null && <span className="text-11 text-muted-foreground">{meta}</span>}
    </div>
  );
}

/** 顶部元信息一行的小分隔条 */
export function MetaSep() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-border" />;
}

/** 状态小徽标：来源/进度等 */
export function StatChip({
  tone = "neutral", children, testId,
}: { tone?: "neutral" | "success" | "warning" | "danger" | "ai"; children: React.ReactNode; testId?: string }) {
  const map: Record<string, string> = {
    neutral: "text-muted-foreground border-border",
    success: "text-success border-success/30 bg-success/5",
    warning: "text-warning border-warning/40 bg-warning/5",
    danger: "text-destructive border-destructive/30 bg-destructive/5",
    ai: "text-ai-tint-foreground border-ai/30 bg-ai-tint",
  };
  return (
    <span
      data-testid={testId}
      className={cn("inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-10 font-medium", map[tone])}
    >
      {children}
    </span>
  );
}

/**
 * 观察者裁剪说明条 —— 当某块内容对观察者**整块消失**（不是变灰）时，
 * 用它替代那块，明确告诉观察者「这里本来有东西，但不在你的只读范围内」。
 * ⚠ 这是「四视角真的改变界面」的可见承诺：内容消失 + 说清原因，而不是留个灰按钮。
 */
export function ObserverNotice({
  what, testId,
}: { what: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-panel px-3.5 py-3 text-11 text-muted-foreground"
    >
      <EyeOff aria-hidden className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{what}</span>
      <Badge tone="outline">观察者只读</Badge>
    </div>
  );
}

/**
 * 组织停用后的只读原因条（uc-00-1 V12：显示只读原因而非隐藏）。
 * 内容仍在，只在顶部挂一条「为什么现在只读」的说明。
 */
export function OrgDisabledBanner({
  title, reason, hint,
}: { title: string; reason: string; hint: string }) {
  return (
    <div
      role="status"
      data-testid="project-org-disabled-banner"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3"
    >
      <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-13 font-medium text-warning-foreground">{title}</span>
          <Badge tone="warning">全项目只读</Badge>
        </div>
        <p className="text-11 text-muted-foreground">{reason}</p>
        <p className="text-11 text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

export { Badge };
