"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { useLayoutEffect, useRef, useState } from 'react';
import { CreditFailureDetails } from '@/components/billing/credit-consumption-notice';
import { agentRunCreditFailure, creditGuidance } from '@/lib/credit-guidance';
import { ApiError } from '@/lib/api-client';
import { WorkflowActionButton } from '@/components/research-studio/research-workflow-actions';
import { generateReportFile, getReportFileJob, downloadReportFile, type ReportFileSource, type ReportFileFormat, type ReportFileJobState } from '@/lib/report-files-api';
const MAX_STATUS_POLLS = 150;
function rememberedJobKey(sourceKey: string, format: string) { return `report-file-job:${sourceKey}:${format}`; }
const labels: Record<ReportFileFormat, string> = { pdf: 'PDF', docx: 'Word' };
type State = { job?: ReportFileJobState; pending?: boolean; error?: MessageKey; notice?: MessageKey };
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
  const { t } = useI18n();
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
    // Only cache an opaque ID. Every restored status read rechecks server actor/source authority.
    const generation = lifecycle.generation;
    for (const format of Object.keys(labels) as ReportFileFormat[]) {
      let id: string | null = null;
      try { id = window.sessionStorage.getItem(rememberedJobKey(sourceKey, format)); } catch { /* Storage is optional. */ }
      if (!id) continue;
      const controller = new AbortController(); activeControllers.set(format, controller);
      void getReportFileJob(id, controller.signal, { observeOnly: true }).then(job => {
        if (generation !== lifecycle.generation || controller.signal.aborted) return;
        if (JSON.stringify([job.source.kind, job.source.id, job.source.reportVersion, job.source.reportHash]) !== sourceKey || job.format !== format) return;
        setStates(prev => ({ ...prev, [format]: { job, ...(job.status === 'failed' ? { error: job.errorCode === 'REPORT_CHANGED' ? 'reportFiles.changed' as const : 'reportFiles.failed' as const } : {}) } }));
      }).catch(() => { /* A denied/transient restored read never dispatches a new conversion. */ })
        .finally(() => { if (activeControllers.get(format) === controller) activeControllers.delete(format); });
    }
    return () => { lifecycle.generation++; activeControllers.forEach(controller => controller.abort()); activeControllers.clear(); };
  }, [sourceKey, disabled]);
  async function act(format: ReportFileFormat) {
    if (controllers.current.has(format)) return;
    const generation = epoch.current.generation;
    const controller = new AbortController(); controllers.current.set(format, controller);
    const current = () => generation === epoch.current.generation && !controller.signal.aborted;
    const update = (state: State) => { if (current()) {
      if (state.job) { try { window.sessionStorage.setItem(rememberedJobKey(sourceKey, format), state.job.id); } catch { /* Storage is optional. */ } }
      setStates(prev => ({ ...prev, [format]: state }));
    } };
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
          update({ job, notice: job.execution?.status === "awaiting_tool_permission" ? undefined : "reportFiles.stillWorking" }); return;
        }
        update({ job, pending: true }); await delay(controller.signal); job = await getReportFileJob(job.id, controller.signal);
      }
      if (!current()) return;
      if (job.status === 'failed') update({ job, error: job.errorCode === 'REPORT_CHANGED' ? 'reportFiles.changed' : 'reportFiles.failed' });
      else { update({ job, pending: true }); await downloadReportFile(job, controller.signal); update({ job }); }
    } catch (error) {
      // A failed read cannot turn the last known live job into a failed conversion.
      // Keep its identity so the next click reads the same job, never resubmits it.
      if (current() && job && (job.status === 'queued' || job.status === 'running')
        && (error instanceof TypeError || error instanceof ApiError && error.status >= 500)) {
        update({ job, notice: 'reportFiles.progressUnavailable' }); return;
      }
      if (current() && job?.status === 'succeeded') {
        try { const refreshed = await getReportFileJob(job.id, controller.signal); if (refreshed.status === 'failed') job = refreshed; } catch (error) { if (error instanceof ApiError && error.reasonCode === 'REPORT_CHANGED') job = undefined; /* Transient reads keep a valid cached file. */ }
      }
      update({ job, error: 'reportFiles.unavailable' });
    } finally { if (current()) controllers.current.delete(format); }
  }
  return <div className="space-y-2" data-testid="report-file-actions">
    <div className="flex flex-wrap items-center gap-2">{(Object.keys(labels) as ReportFileFormat[]).map(format => {
      const state = states[format];
      return <WorkflowActionButton key={format} variant="outline" loading={state?.pending} disabled={disabled || state?.pending} onClick={() => void act(format)}>

        {t(state?.pending ? state.job?.status === 'succeeded' ? 'reportFiles.downloading' : 'reportFiles.generating' : state?.job?.status === 'succeeded' ? 'reportFiles.download' : state?.job && (state.job.status === 'queued' || state.job.status === 'running') ? 'reportFiles.progress' : state?.error ? 'reportFiles.regenerate' : 'reportFiles.generate', { format: labels[format] })}
      </WorkflowActionButton>;
    })}</div>
    {Object.entries(states).filter(([, state]) => state.job?.execution?.status === 'awaiting_tool_permission').map(([format, state]) => <p role="status" key={format} className="text-12 text-muted-foreground">{t("reportFiles.permission", { format: labels[format as ReportFileFormat] })}<a className="underline" href={`/chat/${encodeURIComponent(state.job!.execution!.threadId)}`} target="_blank" rel="noopener noreferrer">{t("reportFiles.continue")}</a></p>)}
    {Object.entries(states).filter(([, state]) => state.notice).map(([format, state]) => <p role="status" key={format} className="text-12 text-muted-foreground">{labels[format as ReportFileFormat]}：{t(state.notice!)}</p>)}
    {Object.entries(states).filter(([, state]) => state.error).map(([format, state]) => {
      const notice = state.job?.status === 'failed' ? creditGuidance(agentRunCreditFailure(state.job.errorCode, state.job.creditFailure)) : null;
      return notice ? <div role="alert" key={format} className="space-y-2" data-testid={`report-credit-guidance-${format}`}>
        <p className="text-12">{labels[format as ReportFileFormat]}</p><CreditFailureDetails notice={notice} />
      </div> : <p role="alert" key={format} className="text-12 text-destructive">{labels[format as ReportFileFormat]}：{t(state.error!)}</p>;
    })}
  </div>;
}
