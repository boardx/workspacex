"use client";
import * as React from "react";
import { ChevronRight, Loader2, Check, AlertCircle, Circle, Wrench, Sparkles } from "lucide-react";
import { RunProgressButterfly } from "@/components/chat/run-progress-butterfly";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries, groupTraceRows, type TraceEntry } from "@/lib/chat-workbench/run-trace";
import { SubtaskRunLivePanel } from "@/components/chat/subtask-run-live-panel";

function detail(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}
const skillStageLabels: Record<string, string> = {
  metadata_discovered: "发现技能元数据", body_read: "读取技能正文",
  execution_started: "技能执行中", execution_succeeded: "技能执行成功", execution_failed: "技能执行失败",
};
/** issue #3218 —— 折叠行只改措辞与层级，成员一条不少地留在展开层里。 */
const skillGroupLabels: Record<string, (count: number) => string> = {
  metadata_discovered: (count) => `已发现 ${count} 个技能`,
};
function groupLabel(stage: string, count: number): string {
  return skillGroupLabels[stage]?.(count) ?? `${skillStageLabels[stage] ?? "技能活动"} · ${count} 项`;
}
function eventLabel(entry: TraceEntry): string {
  if (entry.activityStage) return `${skillStageLabels[entry.activityStage] ?? "技能活动"} · ${entry.text}`;
  if (entry.kind === "skill") return `${entry.status === "failed" ? "技能调用失败" : entry.status === "running" ? "正在调用技能" : "已调用技能"} · ${entry.text}`;
  const action = entry.text === "search_documents" ? "检索资料"
    : entry.text === "spawn_async_task" ? "派发后台任务"
    : entry.text === "write_todos" ? "更新执行计划"
    : entry.text === "run_script" ? "执行生成脚本"
    : "执行工具操作";
  return `${entry.status === "failed" ? `${action}失败` : entry.status === "running" ? `正在${action}` : `已${action}`}`;
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
  const rows = React.useMemo(() => groupTraceRows(entries), [entries]);
  const [now, setNow] = React.useState(Date.now);
  const status = [...events].reverse().find((event) => event.kind === "status");
  const legacy = events.every((event) => event.source === "legacy");
  const active = !legacy && (status?.kind === "status" ? status.status === "running" : running);
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!events.length) return null;
  const started = events.find((event) => event.kind === "status" && event.status === "running") ?? events[0]!;
  const start = Date.parse(started.emittedAt);
  const end = active ? now : Date.parse(events[events.length - 1]!.emittedAt);
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const label = legacy ? "历史执行记录" : status?.kind === "status" && status.status === "cancelled" ? "已停止" : status?.kind === "status" && status.status === "failed" ? "执行失败" : status?.kind === "status" && status.status === "paused" ? "已暂停" : status?.kind === "status" && status.status === "awaiting_tool_permission" ? "等待确认" : active ? "正在执行" : "执行过程";
  const failed = entries.some((entry) => entry.status === "failed");
  const tools = entries.filter((entry) => entry.kind === "tool").length;
  const skills = entries.filter((entry) => entry.kind === "skill").length;
  const hasSubtasks = entries.some((entry) => entry.kind === "tool" && entry.text === "spawn_async_task");
  return <section data-testid="run-trace-panel" data-run-id={runId} className="my-3 min-w-0 text-13 text-muted-foreground">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
      data-testid="run-trace-toggle" className="flex max-w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {active ? <RunProgressButterfly /> : null}
      <span>{failed ? `${label} · 有失败步骤` : label} · 历时 {elapsed} · 工具 {tools} 次 · 技能活动 {skills} 项</span>
      <ChevronRight aria-hidden className={`h-3.5 w-3.5 shrink-0 transition-transform duration-fast ${expanded ? "rotate-90" : ""}`} />
    </button>
    <div id={id} hidden={!expanded} role="region" aria-label="任务执行过程" data-testid="run-trace-body" className="ml-3 border-l border-border-subtle pl-4">
      <ol className="space-y-3 py-3">
        {rows.map((row) => row.kind === "skill-group"
          ? <li key={row.id} data-testid="run-trace-entry" data-kind="skill-group" data-status="observed" data-member-count={row.members.length}>
              <details className="min-w-0">
                <summary className="cursor-pointer rounded-control py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles aria-hidden className="h-3.5 w-3.5" />
                    <span data-testid="chat-task-workbench-event-row">{groupLabel(row.stage, row.members.length)}</span>
                    <Circle aria-label="已记录读取事实，未证明执行成功" className="h-3 w-3" />
                  </span>
                </summary>
                <ul className="space-y-1 pl-4 pt-1">
                  {row.members.map((member) => <li key={member.id} data-testid="run-trace-group-member" data-status={member.status}>{member.text}</li>)}
                </ul>
              </details>
            </li>
          : ((entry) => <li key={entry.id} data-testid="run-trace-entry" data-kind={entry.kind} data-status={entry.status}>
          {entry.kind === "progress" ? <div className="whitespace-pre-wrap break-words leading-relaxed"><span className="mr-2 text-11">{entry.source === "legacy" ? "历史公开记录" : "Thinking · 进展摘要"}</span>{entry.text}</div> :
            <details className="min-w-0">
              <summary className="cursor-pointer rounded-control py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="inline-flex items-center gap-2">
                  {entry.kind === "skill" ? <Sparkles aria-hidden className="h-3.5 w-3.5" /> : <Wrench aria-hidden className="h-3.5 w-3.5" />}
                  <span data-testid="chat-task-workbench-event-row">{eventLabel(entry)}</span>
                  {entry.status === "observed" ? <Circle aria-label="已记录读取事实，未证明执行成功" className="h-3 w-3" /> : entry.status === "running" ? <Loader2 aria-label={running ? "执行中" : "未收到完成状态"} className={running ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> : entry.status === "failed" ? <AlertCircle aria-label="失败" className="h-3 w-3 text-destructive" /> : <Check aria-label={entry.activityStage ? "执行成功" : "工具调用完成"} className="h-3 w-3" />}
                </span>
              </summary>
              {/* issue #3205 —— `mt-1.5` 不是留白偏好，是净空约束：全局 :focus-visible
                  （app/globals.css）是 ring-2 + ring-offset-2，焦点环画在 summary 盒子
                  外面 4px。此前这里净空为 0，那一圈描边整个落进下面卡片的矩形里，被卡片
                  不透明的 bg-card 后画盖掉——人类在 devapp 上看到的「fetch_url 卡片盖住
                  上面那一行」。几何门控见 e2e/chat-trace-disclosure-geometry.spec.ts。 */}
              <div className="mt-1.5 space-y-2 pl-4">
                {entry.activityStage ? null : renderTool?.(entry)}
                {(entry.attemptIds?.length ?? 0) > 1 ? <p>调用在 {entry.attemptIds!.length} 次运行尝试中有记录，合并展示一次。</p> : null}
                {entry.args !== undefined ? <div><span>输入</span><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-2 text-11">{detail(entry.args)}</pre></div> : null}
                {entry.result !== undefined ? <div><span>结果</span><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-2 text-11">{detail(entry.result)}</pre></div> : null}
              </div>
            </details>}
        </li>)(row.entry))}
      </ol>
    </div>
    {/*
      issue #3100 D6 —— 后台任务面板挂在折叠区「之外」。
      它此前挂在 `run-trace-body` 里，而那个区块 `hidden={!expanded}`、默认收起：
      「有 N 个任务在后台运行」这条状态于是被埋在一次展开之后，用户不点开执行过程就
      永远看不到子任务在跑——面板自己已经是"默认摘要、点开看详情"的折叠树（见
      `SubtaskRunPanel`），再套一层折叠是两层折叠，不是渐进式披露。
      挂载条件并没有放宽：仍然要求这一轮真的调用过 `spawn_async_task`（`hasSubtasks`），
      且 `SubtaskRunLivePanel` 自己在后端查不到子任务行时返回 null。
    */}
    {hasSubtasks ? <SubtaskRunLivePanel parentRunId={runId} /> : null}
  </section>;
}
