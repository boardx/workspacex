"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewQualityProjection } from "@/lib/interview-api";

export function DigitalInterviewQualityPanel({ quality, unavailable, onRetry }:
  { readonly quality: DigitalInterviewQualityProjection | null; readonly unavailable?: boolean; readonly onRetry?: () => void }) {
  if (unavailable || !quality) return <aside data-testid="itv-quality-unknown" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
    <p className="font-medium">质量检查暂不可用，当前状态未知</p><p className="mt-1">草稿已保留；恢复检查前不会把未知状态显示为通过。</p>
    {onRetry && <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="size-4" />重试检查</Button>}
  </aside>;
  const issues = [...quality.briefIssues, ...quality.questionFindings.map((item) => ({ ...item, objectId: item.questionId }))];
  const status = quality.readiness?.status ?? "blocking";
  const Icon = status === "ready" ? CheckCircle2 : status === "warning" ? AlertTriangle : XCircle;
  return <aside data-testid="itv-quality-panel" className="rounded-xl border border-border bg-muted/25 p-4">
    <div className="flex items-center gap-2"><Icon className="size-5" aria-hidden /><h3 className="font-semibold">研究质量：{status === "ready" ? "已就绪" : status === "warning" ? "有提醒" : "需修正"}</h3></div>
    {quality.readiness && <p className="mt-2 text-sm text-muted-foreground">预计每位专家 {quality.readiness.estimatedMinutes.min}–{quality.readiness.estimatedMinutes.max} 分钟</p>}
    <ul className="mt-3 space-y-2 text-sm">{issues.map((item, index) => <li key={`${item.code}-${index}`} className={item.severity === "blocking" ? "text-destructive" : "text-warning"}><strong>{item.severity === "blocking" ? "阻断" : "提醒"}</strong> · {item.message}</li>)}</ul>
  </aside>;
}
