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
  expect(downloadReportFile).not.toHaveBeenCalled();
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
