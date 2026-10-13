import { ReportFileJob, ReportFileRequest, ReportFileSourceInfo, REPORT_FILE_FORMATS } from '@repo/contracts/report-files';
import type { z } from 'zod';
import { apiRequest, apiUrl, getStoredSessionToken } from './api-client';
export type ReportFileSource = z.infer<typeof ReportFileRequest>['source'];
export type ReportFileFormat = z.infer<typeof ReportFileRequest>['format'];
export type ReportFileJobState = z.infer<typeof ReportFileJob>;
export async function getReportFileSource(source: Pick<ReportFileSource, 'kind' | 'id'>, signal?: AbortSignal) {
  return ReportFileSourceInfo.parse(await apiRequest(`/report-files/sources/${source.kind}/${encodeURIComponent(source.id)}`, { signal }));
}
export async function generateReportFile(source: ReportFileSource, format: ReportFileFormat, requestId: string, signal?: AbortSignal) {
  return ReportFileJob.parse(await apiRequest('/report-files', { method: 'POST', body: ReportFileRequest.parse({ source, format, requestId }), signal }));
}
export async function getReportFileJob(id: string, signal?: AbortSignal) {
  return ReportFileJob.parse(await apiRequest(`/report-files/${encodeURIComponent(id)}`, { signal }));
}
export async function downloadReportFile(job: ReportFileJobState, signal?: AbortSignal): Promise<void> {
  if (job.status !== 'succeeded') throw new Error('REPORT_UNAVAILABLE');
  const token = getStoredSessionToken();
  if (!token) throw new Error('REPORT_NOT_FOUND');
  const response = await fetch(apiUrl(`/report-files/${encodeURIComponent(job.id)}/download`), {
    credentials: 'include', headers: { Authorization: `Bearer ${token}` }, signal,
  });
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== REPORT_FILE_FORMATS[job.format].mediaType) throw new Error('REPORT_UNAVAILABLE');
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== job.file.sizeBytes || digest !== job.file.sha256) throw new Error('INVALID_FILE');
  const current = await getReportFileJob(job.id, signal);
  if (current.status !== 'succeeded' || current.file.sha256 !== job.file.sha256) throw new Error('REPORT_CHANGED');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = URL.createObjectURL(new Blob([bytes], { type: job.file.mediaType }));
  const link = document.createElement('a'); link.href = url; link.download = job.file.filename;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
