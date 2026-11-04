"use client";
import { recordingDisplay, recordingTaskKeys, recordingTaskDetail } from "./recording-project-display";
import { useRecordingNotice } from "./use-recording-notice";
import { useI18n } from "@/lib/i18n/provider";
import { Check, X, Loader2, RotateCw } from "lucide-react";
import { Toast } from "@/components/admin/panel";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { isReadOnlyRec, type RecView } from "@/lib/mock/rec";
import { PROCESSING_TASKS, type TaskState } from "@/lib/mock/rec-v2";

/**
 * 处理状态 · 六任务独立报状态（原型 16121854）。
 *
 * v1 缺失点：六个任务被一个「处理中」盖住。此屏让每个任务单独报状态——
 * **失败任务（德→中翻译）不阻塞已完成的部分**，你现在就能去校对逐字稿。
 */
export function RecProcess({ state, view }: { state: UiState; view: RecView }) {
  const { t: recT } = useI18n();
  const readOnly = isReadOnlyRec(view);
  const failed = PROCESSING_TASKS.filter((t) => t.state === "failed").length;
  const [toast, setToast] = useRecordingNotice();

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="rec-process">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.process.title")}</h1>
        {failed > 0 && (
          <Badge tone="danger" data-testid="rec-process-failed-badge">{recT("rec.project.process.failed")}</Badge>
        )}
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint={recT("rec.project.this.session.has.no.processing.tasks.yet")}
        errors={{
          task: recT("rec.project.germantochinese.translation.timed.out.for.the.third"),
        }}
        depFailure={{ what: recT("rec.project.the.local.translation.queue.is.unavailable.audio") }}
        denial={{ layer: "project", reason: recT("rec.project.only.facilitators.and.researchers.can.view.and") }}
        successMessage={recT("rec.project.germantochinese.translation.succeeded.on.retry.ai.summaries")}
      >
        <div className="overflow-hidden rounded-lg border border-border-subtle" data-testid="rec-process-tasks">
          {PROCESSING_TASKS.map((t, i) => (
            <div
              key={t.id}
              data-testid={`rec-process-task-${t.id}`}
              className={cn(
                "flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-3",
                i < PROCESSING_TASKS.length - 1 && "border-b border-border-subtle",
                t.state === "failed" && "bg-destructive/5",
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                <TaskIcon state={t.state} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-11 text-background-foreground", t.state === "blocked" && "text-muted-foreground")}>
                    {recordingDisplay(recT, recordingTaskKeys, t.id, t.label)}
                  </p>
                  {t.failNote && (
                    <p className="text-9 text-destructive" data-testid={`rec-process-failnote-${t.id}`}>{t.id === "translate" && /\d+/.test(t.failNote) ? recT("rec.project.taskFailNote", { attempt: t.failNote.match(/\d+/)![0] }) : t.failNote}</p>
                  )}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
                <span className="min-w-0 break-words font-mono text-9 text-muted-foreground">{recordingTaskDetail(recT, t)}</span>
                {t.retryable && (
                  <Button size="xs" variant="primary" disabled={readOnly} onClick={() => setToast(Object.hasOwn(recordingTaskKeys, t.id) ? { key: "rec.project.retryNotice", translatedParams: { label: recordingTaskKeys[t.id]! } } : { key: "rec.project.retryNotice", params: { label: t.label } })} data-testid={`rec-process-retry-${t.id}`}>
                    <RotateCw aria-hidden className="h-3 w-3" />  {recT("rec.project.retry")}
                  </Button>
                )}
              </div>
              <span className="sr-only">{recT(({ done: "rec.project.state.done", running: "rec.project.state.running", failed: "rec.project.state.failed", blocked: "rec.project.state.blocked" } as const)[t.state])}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-dashed border-border-subtle bg-panel p-3" data-testid="rec-process-principle">
          <p className="text-10 leading-relaxed text-muted-foreground">{recT("rec.project.process.principle")}</p>
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
