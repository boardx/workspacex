"use client";
import * as React from "react";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronRight, Loader2, RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  isSubtaskRunActive, SUBTASK_RUN_STATUS_LABEL, SUBTASK_RUN_STATUS_TONE,
  type SubtaskRunStatus, type SubtaskRunView,
} from "@/lib/mock/subtask-run";

/**
 * 后台任务面板（issue #2666，依赖 issue #2664 `spawn_async_task` 的子任务 run）。
 *
 * 挂载点：`ai-message.tsx` 在触发子任务的那条 AI 消息下方渲染本组件——同
 * `ToolCalls`/`CitationList` 一样是消息体内的一个可展开区块，不是独立弹层。
 *
 * ## 三个子组件，各自单一职责
 *
 * `SubtaskRunBadge`：贴在消息上的角标本体，"有 N 个任务在后台运行"，点击展开/收起。
 * `SubtaskRunCard`：单张状态卡，进行中/已完成/出错三态用「色调 + 图形」双重区分
 *   （不只靠文字——`AlertTriangle`/`CheckCircle2`/`Loader2` 三个不同图形 + 三种色调）。
 * `SubtaskRunPanel`：把两者与"收起后仍可继续输入"（本组件不吞任何全局按键/焦点，
 *   纯局部 `useState` 控制展开态，不劫持 composer）、完成通知两条行为组装起来，
 *   是 `ai-message.tsx` 唯一需要 import 的入口。
 *
 * ## 完成通知：不用 toast 库，面板自己画一条轻量条
 *
 * 仓库里没有现成的 toast 基础设施（已用 `grep -rl toast apps/web` 核实过，
 * 命中的全是注释里提到"toast"这个词，没有真正的 toast 组件/依赖）。为这一个
 * 通知引入一个新依赖不划算，所以用面板已有的折叠头承载通知：收起时若有子任务
 * 新近完成，头部数字旁多一条「N 个已完成，点击查看」提示条；点击展开面板并
 * 滚动定位到对应卡片（`data-subtask-id` 锚点 + `scrollIntoView`），符合 AC
 * 「点击能跳转/定位到对应的结果」。
 *
 * ## 不做的事（issue 原文「不做通用项目管理工具」）
 *
 * 没有排序、看板视图、批量操作、拖拽——三个状态卡按入队顺序原样列出。
 */

export interface SubtaskRunPanelProps {
  /** 触发这批子任务的父 run id——供"重试"入队、定位锚点使用。 */
  parentRunId: string;
  runs: SubtaskRunView[];
  /** "重试这一个"——issue #2666 验收标准第三条，简化实现（见调用方 `use-subtask-runs.ts` 头注）。 */
  onRetry?: (run: SubtaskRunView) => void;
  /** 单条子任务正在重试中（用于按钮 loading 态），可选。 */
  retryingId?: string | null;
  defaultOpen?: boolean;
}

export function SubtaskRunPanel({
  parentRunId, runs, onRetry, retryingId, defaultOpen = false,
}: SubtaskRunPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [focusId, setFocusId] = React.useState<string | null>(null);

  // 完成通知：记录上一轮各条的状态，检测"从活跃态转到 completed"这一刻——
  // 只在收起时才需要主动提示（展开时用户本来就看得见状态变化）。
  const prevStatuses = React.useRef<Map<string, SubtaskRunStatus>>(new Map());
  const [justCompletedIds, setJustCompletedIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    const prev = prevStatuses.current;
    const nowCompleted: string[] = [];
    for (const run of runs) {
      const before = prev.get(run.id);
      if (before !== undefined && isSubtaskRunActive({ ...run, status: before }) && run.status === "completed") {
        nowCompleted.push(run.id);
      }
      prev.set(run.id, run.status);
    }
    if (nowCompleted.length > 0 && !open) {
      setJustCompletedIds((v) => [...new Set([...v, ...nowCompleted])]);
    }
  }, [runs, open]);

  if (runs.length === 0) return null;

  const activeCount = runs.filter(isSubtaskRunActive).length;
  const failedCount = runs.filter((r) => r.status === "failed").length;

  function focusRun(id: string) {
    setOpen(true);
    setFocusId(id);
    setJustCompletedIds((v) => v.filter((x) => x !== id));
    // 展开是同步 state 更新，实际卡片下一帧才挂载——排到微任务之后再找元素。
    queueMicrotask(() => {
      const el = document.querySelector(`[data-subtask-id="${CSS.escape(id)}"]`);
      // jsdom（组件测试环境）没有实现 `scrollIntoView`——真实浏览器才有，做特性检测
      // 而不是假设它总存在，避免测试环境里一个纯 UX 细节抛出未捕获异常。
      if (el && "scrollIntoView" in el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  return (
    <div
      className="rounded-md border border-border-subtle bg-card"
      data-testid="chat-subtask-panel"
      data-parent-run-id={parentRunId}
    >
      <SubtaskRunBadge
        open={open}
        activeCount={activeCount}
        failedCount={failedCount}
        total={runs.length}
        onToggle={() => setOpen((v) => !v)}
      />
      {!open && justCompletedIds.length > 0 && (
        <button
          type="button"
          data-testid="chat-subtask-completion-toast"
          onClick={() => focusRun(justCompletedIds[justCompletedIds.length - 1]!)}
          className="flex w-full items-center gap-1.5 border-t border-border-subtle bg-ai-tint/40 px-2.5 py-1.5 text-11 text-ai-tint-foreground transition-colors duration-base hover:bg-ai-tint/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {justCompletedIds.length} 个任务刚完成 · 点击查看
        </button>
      )}
      {open && (
        <ul className="flex flex-col gap-1.5 border-t border-border-subtle p-2" data-testid="chat-subtask-list">
          {runs.map((run) => (
            <SubtaskRunCard
              key={run.id}
              run={run}
              highlighted={focusId === run.id}
              onRetry={onRetry ? () => onRetry(run) : undefined}
              retrying={retryingId === run.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SubtaskRunBadge({
  open, activeCount, failedCount, total, onToggle,
}: {
  open: boolean;
  activeCount: number;
  failedCount: number;
  total: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid="chat-subtask-badge"
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-11 transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        aria-hidden
        className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-fast", open && "rotate-90")}
      />
      <span className="font-medium">
        {activeCount > 0 ? `有 ${activeCount} 个任务在后台运行` : `后台任务 · ${total}`}
      </span>
      {failedCount > 0 && (
        <Badge tone="danger" data-testid="chat-subtask-failed-count">{failedCount} 个出错</Badge>
      )}
    </button>
  );
}

const STATUS_ICON: Record<SubtaskRunStatus, React.ComponentType<{ className?: string }>> = {
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: AlertTriangle,
  cancelled: Ban,
};

function SubtaskRunCard({
  run, highlighted, onRetry, retrying,
}: {
  run: SubtaskRunView;
  highlighted: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const Icon = STATUS_ICON[run.status];
  return (
    <li
      data-testid="chat-subtask-card"
      data-subtask-id={run.id}
      data-status={run.status}
      className={cn(
        "flex flex-col gap-1 rounded-sm border border-transparent px-2 py-1.5 transition-colors duration-base",
        run.status === "failed" && "border-destructive/40 bg-destructive/5",
        highlighted && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <StatusDot status={run.status} Icon={Icon} />
          <span className="min-w-0 flex-1 text-11 text-card-foreground">{run.description}</span>
        </div>
        <span
          data-testid="chat-subtask-status-label"
          className={cn(
            "shrink-0 text-11 font-medium",
            run.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {SUBTASK_RUN_STATUS_LABEL[run.status]}
        </span>
      </div>
      {run.status === "completed" && run.result && (
        <p className="ml-5 rounded-sm bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid="chat-subtask-result">
          {run.result}
        </p>
      )}
      {run.status === "failed" && (
        <div className="ml-5 flex flex-col gap-1">
          <p className="text-10 text-destructive" data-testid="chat-subtask-error">
            {run.error ?? "未知原因，未能完成这个子任务。"}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              data-testid="chat-subtask-retry"
              className="inline-flex w-fit items-center gap-1 rounded-control border border-border px-1.5 py-0.5 text-10 font-medium text-card-foreground transition-colors duration-base hover:bg-muted disabled:bg-disabled disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw aria-hidden className={cn("h-3 w-3", retrying && "animate-spin")} />
              {retrying ? "重试中…" : "重试这一个"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function StatusDot({
  status, Icon,
}: { status: SubtaskRunStatus; Icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Badge tone={SUBTASK_RUN_STATUS_TONE[status]} data-testid="chat-subtask-status-dot">
      <Icon
        aria-hidden
        className={cn("h-3 w-3", (status === "pending" || status === "running") && "animate-spin")}
      />
    </Badge>
  );
}
