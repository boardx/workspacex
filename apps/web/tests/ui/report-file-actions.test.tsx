import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
import { ReportFileActions } from '@/components/report-files/report-file-actions';
import { generateReportFile, downloadReportFile } from '@/lib/report-files-api';
vi.mock('@/lib/report-files-api', () => ({ generateReportFile: vi.fn(), getReportFileJob: vi.fn(), downloadReportFile: vi.fn() }));
const source = { kind: 'interview' as const, id: 'interview-1', reportVersion: 1, reportHash: 'a'.repeat(64) };
const success = { id: 'job-1', source, format: 'pdf' as const, createdAt: '2026-10-13T00:00:00Z', status: 'succeeded' as const,
  skill: { stableName: 'pdf-create', versionId: 'skill-v1', digest: 'b'.repeat(64) },
  file: { filename: 'report.pdf', mediaType: 'application/pdf', sizeBytes: 300, sha256: 'c'.repeat(64) } };
beforeEach(() => vi.resetAllMocks());
it('invokes the product generation API and exposes download only after verified success', async () => {
  vi.mocked(generateReportFile).mockResolvedValue(success);
  render(<ReportFileActions source={source} />);
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  const download = await screen.findByRole('button', { name: '下载 PDF' });
  expect(generateReportFile).toHaveBeenCalledWith(source, 'pdf', expect.any(String), expect.any(AbortSignal));
  expect(downloadReportFile).toHaveBeenCalledTimes(1);
  fireEvent.click(download);
  expect(downloadReportFile).toHaveBeenCalledWith(success, expect.any(AbortSignal));
});
it('discards a late old-version completion and never offers its download after regeneration', async () => {
  let complete!: (value: typeof success) => void;
  vi.mocked(generateReportFile).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { rerender } = render(<ReportFileActions source={source} />);
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  rerender(<ReportFileActions source={{ ...source, reportVersion: 2, reportHash: 'd'.repeat(64) }} />);
  await act(async () => complete(success));
  expect(screen.queryByRole('button', { name: '下载 PDF' })).not.toBeInTheDocument();
  expect(downloadReportFile).not.toHaveBeenCalled();
});
it('shows retry without a download for a failed job', async () => {
  vi.mocked(generateReportFile).mockResolvedValue({ id: success.id, source, format: 'pdf', createdAt: success.createdAt, status: 'failed', errorCode: 'INVALID_FILE' });
  render(<ReportFileActions source={source} />);
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('文件生成失败');
  expect(screen.getByRole('button', { name: '重新生成 PDF' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '下载 PDF' })).not.toBeInTheDocument();
});
it('shows the real Chat permission route while keeping an unfinished run unavailable for download', async () => {
  vi.mocked(generateReportFile).mockResolvedValue({ id: success.id, source, format: 'pdf', createdAt: success.createdAt, status: 'running',
    execution: { runId: 'real-run', threadId: 'real-report-thread', status: 'awaiting_tool_permission' } });
  const { unmount } = render(<ReportFileActions source={source} />);
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  const link = await screen.findByRole('link', { name: '打开对话继续' });
  expect(link).toHaveAttribute('href', '/chat/real-report-thread');
  expect(screen.queryByRole('button', { name: '下载 PDF' })).not.toBeInTheDocument();
  expect(downloadReportFile).not.toHaveBeenCalled();
  unmount();
});
it('checks an awaiting-permission job again instead of creating another conversion',async()=>{
 const {getReportFileJob}=await import('@/lib/report-files-api');
 vi.mocked(generateReportFile).mockResolvedValue({id:success.id,source,format:'pdf',createdAt:success.createdAt,status:'running',execution:{runId:'real-run',threadId:'real-thread',status:'awaiting_tool_permission'}});
 vi.mocked(getReportFileJob).mockResolvedValue(success);
 render(<ReportFileActions source={source}/>);
 fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));
 fireEvent.click(await screen.findByRole('button',{name:'查看 PDF 进度'}));
 await screen.findByRole('button',{name:'下载 PDF'});
 expect(generateReportFile).toHaveBeenCalledTimes(1);expect(getReportFileJob).toHaveBeenCalledWith(success.id,expect.any(AbortSignal));expect(downloadReportFile).toHaveBeenCalledTimes(1);
});
it('retrieves a server-cached current file after remount and downloads without another click',async()=>{
 vi.mocked(generateReportFile).mockResolvedValue(success);
 const view=render(<ReportFileActions source={source}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));await screen.findByRole('button',{name:'下载 PDF'});view.unmount();
 render(<ReportFileActions source={source}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));await screen.findByRole('button',{name:'下载 PDF'});
 expect(downloadReportFile).toHaveBeenCalledTimes(2);
});
it('stops long polling with a resumable job instead of leaving an endless spinner',async()=>{
 const {getReportFileJob}=await import('@/lib/report-files-api');
 const running={id:success.id,source,format:'pdf' as const,createdAt:success.createdAt,status:'running' as const};
 vi.useFakeTimers();
 const view=render(<ReportFileActions source={source}/>);
 try {
  vi.mocked(generateReportFile).mockResolvedValue(running);vi.mocked(getReportFileJob).mockResolvedValue(running);
  fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(302000);});
  expect(screen.getByRole('button',{name:'查看 PDF 进度'})).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('任务仍在处理中');
  expect(generateReportFile).toHaveBeenCalledTimes(1);expect(downloadReportFile).not.toHaveBeenCalled();
 } finally {view.unmount();vi.useRealTimers();}
});
it('refreshes a broken cached file status before offering a new generation',async()=>{
 const {getReportFileJob}=await import('@/lib/report-files-api');
 vi.mocked(generateReportFile).mockResolvedValue(success);vi.mocked(downloadReportFile).mockRejectedValueOnce(new Error('invalid cached file'));
 vi.mocked(getReportFileJob).mockResolvedValue({id:success.id,source,format:'pdf',createdAt:success.createdAt,status:'failed',errorCode:'INVALID_FILE'});
 render(<ReportFileActions source={source}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));
 const retry=await screen.findByRole('button',{name:'重新生成 PDF'});fireEvent.click(retry);
 await screen.findByRole('button',{name:'下载 PDF'});expect(generateReportFile).toHaveBeenCalledTimes(2);
});
it('keeps an existing file on a transient download and status outage',async()=>{
 const {getReportFileJob}=await import('@/lib/report-files-api');
 vi.mocked(generateReportFile).mockResolvedValue(success);vi.mocked(downloadReportFile).mockRejectedValueOnce(new Error('temporary outage'));vi.mocked(getReportFileJob).mockRejectedValue(new Error('unavailable'));
 render(<ReportFileActions source={source}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'下载 PDF'}));await screen.findByRole('button',{name:'下载 PDF'});expect(generateReportFile).toHaveBeenCalledTimes(1);
});
it('drops an obsolete render-policy job after the server confirms REPORT_CHANGED',async()=>{
 const {ApiError}=await import('@/lib/api-client');const {getReportFileJob}=await import('@/lib/report-files-api');
 vi.mocked(generateReportFile).mockResolvedValue(success);vi.mocked(downloadReportFile).mockRejectedValueOnce(new Error('stale representation'));
 vi.mocked(getReportFileJob).mockRejectedValue(new ApiError(409,'REPORT_CHANGED',{}));
 render(<ReportFileActions source={source}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));
 fireEvent.click(await screen.findByRole('button',{name:'重新生成 PDF'}));await screen.findByRole('button',{name:'下载 PDF'});
 expect(generateReportFile).toHaveBeenCalledTimes(2);
});

it.each(['disabled', 'unmount'] as const)('invalidates pending file work immediately on %s', async mode => {
 let complete!: (value: typeof success) => void;
 vi.mocked(generateReportFile).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
 const view = render(<ReportFileActions source={source} />);
 fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
 const signal = vi.mocked(generateReportFile).mock.calls[0]![3]!;
 if (mode === 'disabled') view.rerender(<ReportFileActions source={source} disabled />); else view.unmount();
 expect(signal.aborted).toBe(true);
 await act(async () => complete(success));
 expect(downloadReportFile).not.toHaveBeenCalled();
 expect(screen.queryByRole('button', { name: '下载 PDF' })).not.toBeInTheDocument();
});
it('keeps one user request through StrictMode setup and cleanup', async () => {
 vi.mocked(generateReportFile).mockResolvedValue(success);
 render(<StrictMode><ReportFileActions source={source} /></StrictMode>);
 fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
 await screen.findByRole('button', { name: '下载 PDF' });
 expect(generateReportFile).toHaveBeenCalledTimes(1);
 expect(downloadReportFile).toHaveBeenCalledTimes(1);
});

it.each(['network', 'server'] as const)('keeps a running conversion resumable after a status %s failure without claiming generation failed', async failure => {
 const { ApiError } = await import('@/lib/api-client');
 const { getReportFileJob } = await import('@/lib/report-files-api');
 const running = { id: success.id, source, format: 'pdf' as const, createdAt: success.createdAt, status: 'running' as const };
 vi.useFakeTimers();
 const view = render(<ReportFileActions source={source} />);
 try {
  vi.mocked(generateReportFile).mockResolvedValue(running);
  vi.mocked(getReportFileJob).mockRejectedValueOnce(failure === 'network' ? new TypeError('Failed to fetch') : new ApiError(503, 'unavailable', {})).mockResolvedValue(success);
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('暂时无法更新进度');
  fireEvent.click(screen.getByRole('button', { name: '查看 PDF 进度' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: '下载 PDF' })).toBeEnabled();
  expect(generateReportFile).toHaveBeenCalledTimes(1);
  expect(downloadReportFile).toHaveBeenCalledTimes(1);
 } finally { view.unmount(); vi.useRealTimers(); }
});

it('still reports a confirmed terminal generation failure after reconnecting to the same job', async () => {
 const { getReportFileJob } = await import('@/lib/report-files-api');
 const running = { id: success.id, source, format: 'pdf' as const, createdAt: success.createdAt, status: 'running' as const };
 vi.useFakeTimers(); const view = render(<ReportFileActions source={source} />);
 try {
  vi.mocked(generateReportFile).mockResolvedValue(running);
  vi.mocked(getReportFileJob).mockRejectedValueOnce(new TypeError('Failed to fetch'))
   .mockResolvedValue({ ...running, status: 'failed', errorCode: 'GENERATION_FAILED' });
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.click(screen.getByRole('button', { name: '查看 PDF 进度' }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('文件生成失败');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(generateReportFile).toHaveBeenCalledTimes(1);
  expect(downloadReportFile).not.toHaveBeenCalled();
 } finally { view.unmount(); vi.useRealTimers(); }
});

it('does not turn a status authorization failure into a transient progress notice', async () => {
 const { ApiError } = await import('@/lib/api-client');
 const { getReportFileJob } = await import('@/lib/report-files-api');
 vi.useFakeTimers(); const view = render(<ReportFileActions source={source} />);
 try {
  vi.mocked(generateReportFile).mockResolvedValue({ id: success.id, source, format: 'pdf', createdAt: success.createdAt, status: 'running' });
  vi.mocked(getReportFileJob).mockRejectedValue(new ApiError(403, 'forbidden', {}));
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(downloadReportFile).not.toHaveBeenCalled();
 } finally { view.unmount(); vi.useRealTimers(); }
});
