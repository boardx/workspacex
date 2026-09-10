"use client";
import * as React from "react";
import { ChevronRight, Loader2, Check, AlertCircle, Circle, Wrench, Sparkles } from "lucide-react";
import { RunProgressButterfly } from "@/components/chat/run-progress-butterfly";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries, groupTraceRows, type TraceEntry } from "@/lib/chat-workbench/run-trace";
import { toolLabel } from "@/lib/chat-workbench/tool-label";
import { SubtaskRunLivePanel } from "@/components/chat/subtask-run-live-panel";
import { RunTraceLiveStrip } from "@/components/chat/workbench/run-trace-live-strip";
import { MarkdownMessage } from "@/components/chat/markdown-message";

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
  /**
   * issue #3316 ② —— 这一行**必须说出调用的是哪件工具**。
   *
   * 此前这里是第二份工具名映射：四件工具各有一句动词短语，**其余一律落进
   * 「执行工具操作」这句通用话，`entry.text` 里的真名当场丢掉**。人类跑 pptx 生成时
   * 看到的一串「已执行工具操作」就是这么来的——名字一直在事件里（`tool_start.toolName`），
   * 展开一层也看得见，只有折叠行不说。
   *
   * 现在读 `lib/chat-workbench/tool-label` 那**唯一**一张表，未知工具回落到真名
   * （那条纪律见该文件），一个工具名都不再被抹掉。
   *
   * ⚠ 这只修「已经拿到的事实被抹平」这一半（#3316 ② 的 (c)）。一次工具调用在账本里
   * 至今**只有开始与结束两个时刻**，中间的真实进展从来没有被产生过——那是能力缺失，
   * 按 #3316 的要求另立 **#3322**，不夹带进这个 PR。
   */
  return `${entry.status === "failed" ? "执行失败" : entry.status === "running" ? "正在执行" : "已执行"} · ${toolLabel(entry.text)}`;
}
/**
 * issue #3316 ①（2026-09-10 devapp 人类实测）—— 「正在执行工具操作」那一行的小动画是
 * **静态的**，展开后里面卡片的动画却在转。
 *
 * 根因不是 CSS 把折叠态停掉了，是**「这轮 run 还活着吗」这件事实被声明在两处**：
 *   · 折叠行的标题、计时器、蝴蝶读的是 `active` —— 由执行账本最后一条 `status` 事件定，
 *     是这个面板自己的权威。
 *   · 而这一步的 spinner 此前读的是 `running` prop = `props.isRunning && !final_message`，
 *     其中 `props.isRunning` 是 CopilotKit **逐条消息**的标志。面板挂在本轮**第一条**
 *     assistant 消息上（`resolveTraceAnchors`），长任务里正文早发完、工具还在跑，那条
 *     消息的 `isRunning` 就是 false。
 * 两个答案一分叉，最坏情况就是人类看到的那一幕：抬头写着「正在执行 · 历时 03:54」、
 * 计时器在跳，底下那枚 `<Loader2>` 却不带 `animate-spin` —— 一个**长得像 spinner 的
 * 静态图标**，把「还活着」讲成了「卡死了」。
 *
 * 修法是收敛成一份事实：这枚图标跟着 `active` 走。语义一个字没放宽——run 已经结束、
 * 这一步却还停在 running（真的没收到 tool_end）时，`active` 为 false，图标照旧静态，
 * aria-label 照旧是「未收到完成状态」。
 *
 * 门控：`e2e/chat-trace-collapsed-spinner-liveness.spec.ts`。它**不判 class、不判
 * aria-label**——那两种判据静态图标能轻松通过，在本缺陷下无法被证伪；它判
 * `getAnimations()` 的 `playState` + 隔 20 帧的 transform 两帧比对 + 命中测试。
 */
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
  /**
   * issue #3320 的活性文案（此刻在做什么 · 已完成 N 步）现在就画在**这一行的最前面**，
   * 所以本行不再自己重复一句「正在执行」——那正是人类实测里「工具调用的 2 个消息重复了」
   * 的那两句。`active` 期间恒定不变的事实（历时 / 计数 / 有没有失败过）留在后半段。
   */
  const head = active ? null : failed ? `${label} · 有失败步骤` : label;
  const tail = `${active && failed ? "有失败步骤 · " : ""}历时 ${elapsed} · 工具 ${String(tools)} 次 · 技能活动 ${String(skills)} 项`;
  return <section data-testid="run-trace-panel" data-run-id={runId} className="my-3 min-w-0 text-13 text-muted-foreground">
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
      data-testid="run-trace-toggle" className="flex max-w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {/* issue #3320 的活性动画就是这一枚：`active` 期间恒在、恒动（`animate-butterfly-fly`），
          挂在折叠区外面，不吃 `expanded`。它是这一行唯一的活性信号——活性文案此前另起一行、
          另带一枚 `Loader2`，两处讲同一件事，见 `run-trace-live-strip.tsx` 头注。 */}
      {active ? <RunProgressButterfly /> : null}
      {/* 活性文案与恒定事实是一句话，中间只有一个「 · 」：所以这两段不吃外层的 gap-2，
          自己合成一个不带间距的行内组（分隔符前的空格用 \u00A0，免得被行盒首尾空白折掉）。 */}
      <span className="flex min-w-0 items-center">
        <RunTraceLiveStrip entries={entries} active={active} />
        <span className="min-w-0">{head === null ? ` · ${tail}` : `${head} · ${tail}`}</span>
      </span>
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
          : ((entry) => <li key={entry.id} data-testid="run-trace-entry" data-kind={entry.kind} data-status={entry.status} data-tool-name={entry.kind === "tool" ? entry.text : undefined}>
          {/* issue #3387 ② —— 进展摘要是**模型写的 markdown**（人类实测里原样显示了
              `### 2026 年上半年（H1）整体表现` 与 `- 加粗的「产量」`）。此前这里
              把它当纯文本塞进一个 `whitespace-pre-wrap` 的 div：`###` / `**` 全部字面
              显示。改走与 assistant 正文同一个 `MarkdownMessage`（同一份 remark-gfm
              + rehype-sanitize 清洗），只换一个自己的 `data-testid`。
              ⚠ 执行过程里其它文本块一律不动：工具的「输入」/「结果」是 JSON，本来就该
              留在 `<pre>` 里原样显示，把它们也当 markdown 渲染是另一个 bug。 */}
          {entry.kind === "progress" ? <div className="break-words leading-relaxed"><span className="mr-2 text-11">{entry.source === "legacy" ? "历史公开记录" : "Thinking · 进展摘要"}</span><MarkdownMessage text={entry.text} testId="run-trace-progress-markdown" /></div> :
            <details className="min-w-0">
              <summary className="cursor-pointer rounded-control py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="inline-flex items-center gap-2">
                  {entry.kind === "skill" ? <Sparkles aria-hidden className="h-3.5 w-3.5" /> : <Wrench aria-hidden className="h-3.5 w-3.5" />}
                  <span data-testid="chat-task-workbench-event-row">{eventLabel(entry)}</span>
                  {entry.status === "observed" ? <Circle data-testid="run-trace-entry-status-icon" aria-label="已记录读取事实，未证明执行成功" className="h-3 w-3" /> : entry.status === "running" ? <Loader2 data-testid="run-trace-entry-status-icon" aria-label={active ? "执行中" : "未收到完成状态"} className={active ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> : entry.status === "failed" ? <AlertCircle data-testid="run-trace-entry-status-icon" aria-label="失败" className="h-3 w-3 text-destructive" /> : <Check data-testid="run-trace-entry-status-icon" aria-label={entry.activityStage ? "执行成功" : "工具调用完成"} className="h-3 w-3" />}
                </span>
                {/* issue #3322 —— 最近一条工具内进展，画在**折叠行上**。
                    用户的原话是「等了很久没有任何的细节」；把细节藏在 <details> 里等人
                    去展开，等于没有——他看到的仍然是一串「已执行 · execute」。
                    只画最新一条：这一行只有一行的位置，而进展本身就是节流采样。 */}
                {entry.progressText ? <span data-testid="run-trace-entry-progress" className="ml-2 truncate text-11 text-muted-foreground">{entry.progressText}</span> : null}
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
