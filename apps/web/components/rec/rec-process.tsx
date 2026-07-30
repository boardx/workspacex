"use client";
import * as React from "react";
import { Check, X, Loader2, RotateCw } from "lucide-react";
import { Toast } from "@/components/admin/panel";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { isReadOnlyRec, type RecView } from "@/lib/mock/rec";
import { PROCESSING_TASKS, PROCESS_META, TASK_STATE_LABEL, type TaskState } from "@/lib/mock/rec-v2";

/**
 * 处理状态 · 六任务独立报状态（原型 16121854）。
 *
 * v1 缺失点：六个任务被一个「处理中」盖住。此屏让每个任务单独报状态——
 * **失败任务（德→中翻译）不阻塞已完成的部分**，你现在就能去校对逐字稿。
 */
export function RecProcess({ state, view }: { state: UiState; view: RecView }) {
  const readOnly = isReadOnlyRec(view);
  const failed = PROCESSING_TASKS.filter((t) => t.state === "failed").length;
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="rec-process">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-18 font-semibold tracking-tight">{PROCESS_META.title}</h1>
        {failed > 0 && (
          <Badge tone="danger" data-testid="rec-process-failed-badge">{PROCESS_META.failedBadge}</Badge>
        )}
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="本场还没有产生任何处理任务——录制未结束或音频未上传。"
        errors={{
          task: "德语→中文对照翻译连续第 3 次超时；系统不静默跳过、也不用一个「处理失败」盖住其它任务，失败项单独标红并保留可重试。",
        }}
        depFailure={{ what: "本地翻译模型队列不可用；音频与原文不受影响，其它任务照常推进。" }}
        denial={{ layer: "project", reason: "只有引导师/研究员可查看与重试处理任务；你可见结果但不能触发重试。" }}
        successMessage="德语→中文对照翻译重试成功 → AI 摘要与证据提取已解除阻塞，开始运行。"
      >
        <div className="overflow-hidden rounded-lg border border-border-subtle" data-testid="rec-process-tasks">
          {PROCESSING_TASKS.map((t, i) => (
            <div
              key={t.id}
              data-testid={`rec-process-task-${t.id}`}
              className={cn(
                "flex items-center gap-3 px-3.5 py-3",
                i < PROCESSING_TASKS.length - 1 && "border-b border-border-subtle",
                t.state === "failed" && "bg-destructive/5",
              )}
            >
              <TaskIcon state={t.state} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-11 text-foreground", t.state === "blocked" && "text-muted-foreground")}>
                  {t.label}
                </p>
                {t.failNote && (
                  <p className="text-9 text-destructive" data-testid={`rec-process-failnote-${t.id}`}>{t.failNote}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-9 text-muted-foreground">{t.detail}</span>
              {t.retryable && (
                <Button size="xs" variant="primary" disabled={readOnly} onClick={() => setToast(`重试「${t.label}」（mock）：不阻塞其它任务`)} data-testid={`rec-process-retry-${t.id}`}>
                  <RotateCw aria-hidden className="h-3 w-3" /> 重试
                </Button>
              )}
              <span className="sr-only">{TASK_STATE_LABEL[t.state]}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-dashed border-border-subtle bg-panel p-3" data-testid="rec-process-principle">
          <p className="text-10 leading-relaxed text-muted-foreground">{PROCESS_META.principle}</p>
        </div>
      </StateShell>
      <Toast message={toast} testid="rec-process-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}

function TaskIcon({ state }: { state: TaskState }) {
  if (state === "done")
    return <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded bg-success/15 text-9 text-success"><Check aria-hidden className="h-2.5 w-2.5" /></span>;
  if (state === "running")
    return <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded bg-warning/15 text-warning"><Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" /></span>;
  if (state === "failed")
    return <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded bg-destructive text-9 text-destructive-foreground"><X aria-hidden className="h-2.5 w-2.5" /></span>;
  return <span className="h-3.5 w-3.5 shrink-0 rounded border-[1.5px] border-border" />;
}
