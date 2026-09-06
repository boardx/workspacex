"use client";
import * as React from "react";
import { ChevronRight, Loader2, Check, AlertCircle, Wrench, Sparkles } from "lucide-react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries, type TraceEntry } from "@/lib/chat-workbench/run-trace";

function detail(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}
/** A disclosure never changes the lifetime of the event subscription. */
export function RunTracePanel({ runId, events, running = false, expanded: controlledExpanded, onExpandedChange, renderTool }: {
  runId: string; events: readonly ExecutionEvent[]; running?: boolean; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; renderTool?: (entry: TraceEntry) => React.ReactNode;
}): JSX.Element | null {
  const [localExpanded, setLocalExpanded] = React.useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const id = React.useId();
  const entries = React.useMemo(() => traceEntries(events), [events]);
  const [now, setNow] = React.useState(Date.now);
  const status = [...events].reverse().find((event) => event.kind === "status");
  const active = status?.kind === "status" ? status.status === "running" : running;
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!events.length) return null;
  const start = Date.parse(events[0]!.emittedAt);
  const end = active ? now : Date.parse(events[events.length - 1]!.emittedAt);
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
  const elapsed = seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const label = status?.kind === "status" && status.status === "failed" ? "执行失败" : status?.kind === "status" && status.status === "paused" ? "已暂停" : status?.kind === "status" && status.status === "awaiting_tool_permission" ? "等待确认" : active ? "正在执行" : "执行过程";
  const failed = entries.some((entry) => entry.status === "failed");
  const tools = entries.filter((entry) => entry.kind === "tool").length;
  const skills = entries.filter((entry) => entry.kind === "skill").length;
  return <section data-testid="run-trace-panel" data-run-id={runId} className="my-3 min-w-0 text-13 text-muted-foreground">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
      data-testid="run-trace-toggle" className="flex max-w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {active ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
      <span>{failed ? `${label} · 有失败步骤` : label} · {elapsed} · 工具 {tools} 次 · 技能 {skills} 次</span>
      <ChevronRight aria-hidden className={`h-3.5 w-3.5 shrink-0 transition-transform duration-fast ${expanded ? "rotate-90" : ""}`} />
    </button>
    <div id={id} hidden={!expanded} role="region" aria-label="任务执行过程" data-testid="run-trace-body" className="ml-3 border-l border-border-subtle pl-4">
      <ol className="space-y-3 py-3">
        {entries.map((entry) => <li key={entry.id} data-testid="run-trace-entry" data-kind={entry.kind} data-status={entry.status}>
          {entry.kind === "progress" ? <div className="whitespace-pre-wrap break-words leading-relaxed"><span className="mr-2 text-11">Thinking · 进展摘要</span>{entry.text}</div> :
            <details className="min-w-0">
              <summary className="cursor-pointer rounded-control py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="inline-flex items-center gap-2">
                  {entry.kind === "skill" ? <Sparkles aria-hidden className="h-3.5 w-3.5" /> : <Wrench aria-hidden className="h-3.5 w-3.5" />}
                  <span>{entry.kind === "skill" ? "Skill" : "Tool"} · {entry.text}</span>
                  {entry.status === "running" ? <Loader2 aria-label={running ? "执行中" : "未收到完成状态"} className={running ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> : entry.status === "failed" ? <AlertCircle aria-label="失败" className="h-3 w-3 text-destructive" /> : <Check aria-label="完成" className="h-3 w-3" />}
                </span>
              </summary>
              <div className="space-y-2 pl-4">
                {renderTool?.(entry)}
                {entry.args !== undefined ? <div><span>输入</span><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-2 text-11">{detail(entry.args)}</pre></div> : null}
                {entry.result !== undefined ? <div><span>结果</span><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-2 text-11">{detail(entry.result)}</pre></div> : null}
              </div>
            </details>}
        </li>)}
      </ol>
    </div>
  </section>;
}
