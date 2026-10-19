"use client";
import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { WorkflowActionButton } from '@/components/research-studio/research-workflow-actions';
import { generateReportFile, getReportFileJob, downloadReportFile, type ReportFileSource, type ReportFileFormat, type ReportFileJobState } from '@/lib/report-files-api';
const MAX_STATUS_POLLS = 150;
const labels: Record<ReportFileFormat, string> = { pdf: 'PDF', docx: 'Word' };
type State = { job?: ReportFileJobState; pending?: boolean; error?: string; notice?: string };
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Shared report controls. The server owns canonical content, Skill execution and file access. */
export function ReportFileActions({ source, disabled = false }: { source: ReportFileSource; disabled?: boolean }) {
  const [states, setStates] = useState<Partial<Record<ReportFileFormat, State>>>({});
  const epoch = useRef({ generation: 0 });
  const controllers = useRef(new Map<ReportFileFormat, AbortController>());
  const sourceKey = JSON.stringify([source.kind, source.id, source.reportVersion, source.reportHash]);
  // Establish/retire the source epoch before committed controls can receive input.
  useLayoutEffect(() => {
    const lifecycle = epoch.current;
    const activeControllers = controllers.current;
    lifecycle.generation++;
    activeControllers.forEach(controller => controller.abort()); activeControllers.clear(); setStates({});
    return () => { lifecycle.generation++; activeControllers.forEach(controller => controller.abort()); activeControllers.clear(); };
  }, [sourceKey, disabled]);
  async function act(format: ReportFileFormat) {
    if (controllers.current.has(format)) return;
    const generation = epoch.current.generation;
    const controller = new AbortController(); controllers.current.set(format, controller);
    const current = () => generation === epoch.current.generation && !controller.signal.aborted;
    const update = (state: State) => { if (current()) setStates(prev => ({ ...prev, [format]: state })); };
    update({ ...states[format], pending: true, error: undefined });
    let job = states[format]?.job;
    try {
      const existing = job;
      if (existing?.status === 'succeeded') { await downloadReportFile(existing, controller.signal); update({ job: existing }); return; }
      job = existing && (existing.status === "queued" || existing.status === "running")
        ? await getReportFileJob(existing.id, controller.signal)
        : await generateReportFile(source, format, crypto.randomUUID(), controller.signal);
      let polls = 0;
      while (current() && (job.status === 'queued' || job.status === 'running')) {
        if (job.execution?.status === "awaiting_tool_permission" || polls++ >= MAX_STATUS_POLLS) {
          update({ job, notice: job.execution?.status === "awaiting_tool_permission" ? undefined : "任务仍在处理中，可稍后查看进度，无需重复生成。" }); return;
        }
        update({ job, pending: true }); await delay(controller.signal); job = await getReportFileJob(job.id, controller.signal);
      }
      if (!current()) return;
      if (job.status === 'failed') update({ job, error: job.errorCode === 'REPORT_CHANGED' ? '报告已更新，请基于当前版本重新生成。' : '文件生成失败，请重试。' });
      else { update({ job, pending: true }); await downloadReportFile(job, controller.signal); update({ job }); }
    } catch (error) {
      // A failed read cannot turn the last known live job into a failed conversion.
      // Keep its identity so the next click reads the same job, never resubmits it.
      if (current() && job && (job.status === 'queued' || job.status === 'running')
        && (error instanceof TypeError || error instanceof ApiError && error.status >= 500)) {
        update({ job, notice: '暂时无法更新进度，可稍后查看，当前任务无需重复生成。' }); return;
      }
      if (current() && job?.status === 'succeeded') {
        try { const refreshed = await getReportFileJob(job.id, controller.signal); if (refreshed.status === 'failed') job = refreshed; } catch (error) { if (error instanceof ApiError && error.reasonCode === 'REPORT_CHANGED') job = undefined; /* Transient reads keep a valid cached file. */ }
      }
      update({ job, error: '文件暂时无法生成或下载，请确认当前报告后重试。' });
    } finally { if (current()) controllers.current.delete(format); }
  }
  return <div className="space-y-2" data-testid="report-file-actions">
    <div className="flex flex-wrap items-center gap-2">{(Object.keys(labels) as ReportFileFormat[]).map(format => {
      const state = states[format];
      return <WorkflowActionButton key={format} variant="outline" loading={state?.pending} disabled={disabled || state?.pending} onClick={() => void act(format)}>

        {state?.pending ? `正在${state.job?.status === 'succeeded' ? '下载' : '生成'} ${labels[format]}…` : state?.job?.status === 'succeeded' ? `下载 ${labels[format]}` : state?.job && (state.job.status === 'queued' || state.job.status === 'running') ? `查看 ${labels[format]} 进度` : state?.error ? `重新生成 ${labels[format]}` : `生成 ${labels[format]}`}
      </WorkflowActionButton>;
    })}</div>
    {Object.entries(states).filter(([, state]) => state.job?.execution?.status === 'awaiting_tool_permission').map(([format, state]) => <p role="status" key={format} className="text-12 text-muted-foreground">{labels[format as ReportFileFormat]}：需要确认工具权限。<a className="underline" href={`/chat/${encodeURIComponent(state.job!.execution!.threadId)}`} target="_blank" rel="noopener noreferrer">打开对话继续</a></p>)}
    {Object.entries(states).filter(([, state]) => state.notice).map(([format, state]) => <p role="status" key={format} className="text-12 text-muted-foreground">{labels[format as ReportFileFormat]}：{state.notice}</p>)}
    {Object.entries(states).filter(([, state]) => state.error).map(([format, state]) => <p role="alert" key={format} className="text-12 text-destructive">{labels[format as ReportFileFormat]}：{state.error}</p>)}
  </div>;
}
