"use client";
import * as React from "react";
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

export { Badge };
