"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { useEffect, useState } from "react";
import { researchExecutionTimeline, type ExecutionStatus } from '@/lib/research-execution-timeline';
import type { GuidedResearchRuntime } from '@/lib/guided-research-api';
const labels: Record<ExecutionStatus, MessageKey> = { pending: "research.executionStatus.pending", running: "research.executionStatus.running", completed: "ui.completed", failed: "ui.failed", warning: "research.executionStatus.warning", paused: "ui.paused", interrupted: "research.executionStatus.interrupted" };
export function GuidedResearchExecutionTimeline({state,interrupted=false}:{state:GuidedResearchRuntime;interrupted?:boolean}) {
  const { t, locale } = useI18n();
  const timeline=researchExecutionTimeline(state,interrupted,locale);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!state.busy || interrupted || state.controlStatus === 'paused') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.sessionId, state.version, state.busy, state.controlStatus, interrupted]);
  const started = state.activity?.find(event => event.executionVersion === state.version && event.status === 'started');
  const startedAt = started ? Date.parse(started.occurredAt) : NaN;
  const elapsed = now !== null && state.busy && Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;
  return <section aria-label={t("research.timeline.heading")} data-testid="research-execution-timeline" className="rounded-xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">{t("research.timeline.heading")}</h2>
    {elapsed !== null && <p className="mt-2 text-sm text-muted-foreground" data-testid="research-execution-elapsed">{t("research.timeline.elapsed", { minutes: Math.floor(elapsed / 60), seconds: elapsed % 60 })}</p>}
    <p role="status" className="mt-2 text-sm text-muted-foreground">{timeline.summary}</p>
    <ol className="mt-4 space-y-3">{timeline.rows.map(row=><li key={row.id} data-testid={`execution-${row.id}`} className="text-sm"><div className="flex items-start justify-between gap-4"><span>{row.title}</span><span className={row.status==='failed'?'shrink-0 text-destructive':'shrink-0 text-muted-foreground'}>{row.id === 'documents' && row.status === 'warning' ? t('research.timeline.continueDocuments') : t(labels[row.status])}</span></div>{row.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{row.detail}</p>}</li>)}</ol>
  </section>;
}
