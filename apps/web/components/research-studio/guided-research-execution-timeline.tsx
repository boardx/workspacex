import { researchExecutionTimeline, type ExecutionStatus } from '@/lib/research-execution-timeline';
import type { GuidedResearchRuntime } from '@/lib/guided-research-api';
const labels: Record<ExecutionStatus,string> = {pending:'待执行',running:'执行中',completed:'已完成',failed:'失败',warning:'待核实',paused:'已暂停',interrupted:'已中断'};
export function GuidedResearchExecutionTimeline({state,interrupted=false}:{state:GuidedResearchRuntime;interrupted?:boolean}) {
  const timeline=researchExecutionTimeline(state,interrupted);
  return <section aria-label="研究执行过程" data-testid="research-execution-timeline" className="rounded-xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">研究执行过程</h2>
    <p role="status" className="mt-2 text-sm text-muted-foreground">{timeline.summary}</p>
    <ol className="mt-4 space-y-3">{timeline.rows.map(row=><li key={row.id} data-testid={`execution-${row.id}`} className="flex items-center justify-between gap-4 text-sm"><span>{row.title}</span><span className={row.status==='failed'?'text-destructive':'text-muted-foreground'}>{labels[row.status]}</span></li>)}</ol>
  </section>;
}
