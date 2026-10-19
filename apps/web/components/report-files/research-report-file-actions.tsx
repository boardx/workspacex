"use client";
import { useEffect, useState } from 'react';
import { getReportFileSource, type ReportFileSource } from '@/lib/report-files-api';
import { ReportFileActions } from './report-file-actions';
export function ResearchReportFileActions({ sessionId, reportVersion, disabled = false }: { sessionId: string; reportVersion: number; disabled?: boolean }) {
  const [binding, setBinding] = useState<ReportFileSource | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setBinding(null); setError(false);
    if (disabled) return;
    const controller = new AbortController();
    void getReportFileSource({ kind: 'research', id: sessionId }, controller.signal).then(source => {
      if (!controller.signal.aborted && source.reportVersion === reportVersion) setBinding({ kind: source.kind, id: source.id, reportVersion: source.reportVersion, reportHash: source.reportHash });
      else if (!controller.signal.aborted) setError(true);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [sessionId, reportVersion, disabled]);
  if (disabled) return null;
  if (!binding || binding.id !== sessionId || binding.reportVersion !== reportVersion) return <p role={error ? 'alert' : 'status'} className="text-12 text-muted-foreground">{error ? '当前报告文件生成暂不可用，请刷新报告后重试。' : '正在同步报告文件版本…'}</p>;
  return <ReportFileActions key={`${binding.id}:${binding.reportVersion}:${binding.reportHash}`} source={binding} />;
}
