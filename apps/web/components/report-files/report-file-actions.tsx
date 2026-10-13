"use client";
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateReportFile, getReportFileJob, downloadReportFile, type ReportFileSource, type ReportFileFormat, type ReportFileJobState } from '@/lib/report-files-api';
const labels: Record<ReportFileFormat, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PPT' };
type State = { job?: ReportFileJobState; pending?: boolean; error?: string };
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
  useEffect(() => {
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
    try {
      const existing = states[format]?.job;
      if (existing?.status === 'succeeded') { await downloadReportFile(existing, controller.signal); update({ job: existing }); return; }
      let job = await generateReportFile(source, format, crypto.randomUUID(), controller.signal);
      while (current() && (job.status === 'queued' || job.status === 'running')) {
        update({ job, pending: true }); await delay(controller.signal); job = await getReportFileJob(job.id, controller.signal);
      }
      if (job.status === 'failed') update({ job, error: job.errorCode === 'REPORT_CHANGED' ? '报告已更新，请基于当前版本重新生成。' : '文件生成失败，请重试。' });
      else update({ job });
    } catch {
      update({ error: '文件暂时无法生成或下载，请确认当前报告后重试。' });
    } finally { if (current()) controllers.current.delete(format); }
  }
  return <div className="space-y-2" data-testid="report-file-actions">
    <div className="flex flex-wrap items-center gap-2">{(Object.keys(labels) as ReportFileFormat[]).map(format => {
      const state = states[format];
      return <Button key={format} variant="outline" size="sm" disabled={disabled || state?.pending} onClick={() => void act(format)}>
        {state?.pending && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
        {state?.pending ? `正在${state.job?.status === 'succeeded' ? '下载' : '生成'} ${labels[format]}…` : state?.job?.status === 'succeeded' ? `下载 ${labels[format]}` : state?.error ? `重新生成 ${labels[format]}` : `生成 ${labels[format]}`}
      </Button>;
    })}</div>
    {Object.entries(states).filter(([, state]) => state.error).map(([format, state]) => <p role="alert" key={format} className="text-12 text-destructive">{labels[format as ReportFileFormat]}：{state.error}</p>)}
  </div>;
}
