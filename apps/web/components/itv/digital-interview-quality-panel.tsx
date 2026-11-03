"use client";
import { interviewQualityText } from "@/lib/interview-quality-text";
import { useI18n } from "@/lib/i18n/provider";

import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewQualityProjection } from "@/lib/interview-api";

export function DigitalInterviewQualityPanel({ quality, unavailable, onRetry }:
  { readonly quality: DigitalInterviewQualityProjection | null; readonly unavailable?: boolean; readonly onRetry?: () => void }) {
 const { t, locale } = useI18n();
  if (unavailable || !quality) return <aside data-testid="itv-quality-unknown" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
    <p className="font-medium">{t("itv.quality.unknown")}</p><p className="mt-1">{t("itv.quality.preserved")}</p>
    {onRetry && <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="size-4" />{t("itv.quality.retry")}</Button>}
  </aside>;
  const issues = [...quality.briefIssues, ...quality.questionFindings.map((item) => ({ ...item, objectId: item.questionId }))];
  const status = quality.readiness?.status ?? "blocking";
  const Icon = status === "ready" ? CheckCircle2 : status === "warning" ? AlertTriangle : XCircle;
  return <aside data-testid="itv-quality-panel" className="rounded-xl border border-border bg-muted/25 p-4">
    <div className="flex items-center gap-2"><Icon className="size-5" aria-hidden /><h3 className="font-semibold">{t("itv.quality.status", { status: status === "ready" ? t("itv.quality.ready") : status === "warning" ? t("itv.quality.warning") : t("itv.quality.blocking") })}</h3></div>
    {quality.readiness && <p className="mt-2 text-sm text-muted-foreground">{t("itv.quality.minutes", { min: quality.readiness.estimatedMinutes.min, max: quality.readiness.estimatedMinutes.max })}</p>}
    <ul className="mt-3 space-y-2 text-sm">{issues.map((item, index) => <li key={`${item.code}-${index}`} className={item.severity === "blocking" ? "text-destructive" : "text-warning"}><strong>{item.severity === "blocking" ? t("itv.quality.blocker") : t("itv.quality.notice")}</strong> · {interviewQualityText(item, locale)}</li>)}</ul>
  </aside>;
}
