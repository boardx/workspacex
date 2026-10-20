"use client";
import { useEffect, useState } from "react";
import { researchExecutionTimeline, type ExecutionStatus } from '@/lib/research-execution-timeline';
import type { GuidedResearchRuntime } from '@/lib/guided-research-api';
const labels: Record<ExecutionStatus,string> = {pending:'待执行',running:'执行中',completed:'已完成',failed:'失败',warning:'部分未完成',paused:'已暂停',interrupted:'已中断'};
export function GuidedResearchExecutionTimeline({state,interrupted=false}:{state:GuidedResearchRuntime;interrupted?:boolean}) {
  const timeline=researchExecutionTimeline(state,interrupted);
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
  return <section aria-label="研究执行过程" data-testid="research-execution-timeline" className="rounded-xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">研究执行过程</h2>
    {elapsed !== null && <p className="mt-2 text-sm text-muted-foreground" data-testid="research-execution-elapsed">已用时 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒</p>}
    <p role="status" className="mt-2 text-sm text-muted-foreground">{timeline.summary}</p>
    <ol className="mt-4 space-y-3">{timeline.rows.map(row=><li key={row.id} data-testid={`execution-${row.id}`} className="text-sm"><div className="flex items-start justify-between gap-4"><span>{row.title}</span><span className={row.status==='failed'?'shrink-0 text-destructive':'shrink-0 text-muted-foreground'}>{row.id === 'documents' && row.status === 'warning' ? '待继续整理' : labels[row.status]}</span></div>{row.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{row.detail}</p>}</li>)}</ol>
  </section>;
}
