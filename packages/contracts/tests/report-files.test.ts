import { expect, it } from 'vitest';
import { ReportFileRequest, ReportFileJob } from '../src/report-files';
const source = { kind: 'interview', id: 'interview-1', reportVersion: 3, reportHash: 'a'.repeat(64) };
it('accepts only a source locator and an exact real file format', () => {
  for (const format of ['pdf', 'docx']) expect(ReportFileRequest.parse({ source, format, requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a' }).format).toBe(format);
  expect(ReportFileRequest.safeParse({ source, format: 'pptx', requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a' }).success).toBe(false);
  expect(ReportFileRequest.safeParse({ source, format: 'html', requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a' }).success).toBe(false);
  expect(ReportFileRequest.safeParse({ source, format: 'pdf', requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a', markdown: 'client injected' }).success).toBe(false);
});
it('never advertises a file on a failed or pending job', () => {
  const base = { id: 'job-1', source, format: 'pdf', createdAt: '2026-10-13T00:00:00Z' };
  expect(ReportFileJob.safeParse({ ...base, status: 'failed', errorCode: 'INVALID_FILE' }).success).toBe(true);
  expect(ReportFileJob.safeParse({ ...base, status: 'failed', errorCode: 'INVALID_FILE', file: {} }).success).toBe(false);
  expect(ReportFileJob.safeParse({ ...base, status: 'queued', file: {} }).success).toBe(false);
});
it('rejects successful metadata with a renamed HTML file or unsafe filename', () => {
  const job = { id: 'job-1', source, format: 'pdf', createdAt: '2026-10-13T00:00:00Z', status: 'succeeded',
    skill: { stableName: 'pdf-create', versionId: 'version-1', digest: 'b'.repeat(64) },
    file: { filename: 'report.pdf', mediaType: 'application/pdf', sizeBytes: 1024, sha256: 'c'.repeat(64) } };
  expect(ReportFileJob.safeParse(job).success).toBe(true);
  expect(ReportFileJob.safeParse({ ...job, file: { ...job.file, mediaType: 'text/html' } }).success).toBe(false);
  expect(ReportFileJob.safeParse({ ...job, file: { ...job.file, filename: '../report.pdf' } }).success).toBe(false);
});
