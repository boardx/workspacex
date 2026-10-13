import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ReportFileService } from '../../src/application/report-files/service';
import { toOrgId } from '../../src/domain/org-id';
import type { StoredReportFileJob } from '../../src/application/report-files/job-ports';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const actor = { orgId: toOrgId('org-1'), userId: 'user-1' };
  let snapshot = { kind: 'interview' as const, id: 'report-1', title: '报告', reportVersion: 1,
    markdown: '# 报告\n正文', reportHash: hash('# 报告\n正文'), bindingKey: 'revision-1/document-1/1', projectId: null, notices: [] as string[] };
  const records = new Map<string, StoredReportFileJob>();
  const store = {
    findByRequest: vi.fn(async (who: typeof actor, id: string) => [...records.values()].find(r => r.requestId === id && r.actor.orgId === who.orgId && r.actor.userId === who.userId) ?? null),
    insert: vi.fn(async (r: StoredReportFileJob) => { if ([...records.values()].some(x => x.requestId === r.requestId)) return false; records.set(r.job.id, r); return true; }),
    get: vi.fn(async (who: typeof actor, id: string) => { const r = records.get(id); return r?.actor.userId === who.userId && r.actor.orgId === who.orgId ? r : null; }),
    claim: vi.fn(async (_who: typeof actor, id: string) => { const record = records.get(id)!; return record.job.status === 'queued' ? { record, leaseToken: 'lease-1' } : null; }),
    saveThread: vi.fn(async (_claim: unknown, threadId: string) => { const r = records.get('job-1')!; records.set('job-1', { ...r, threadId }); return true; }),
    update: vi.fn(async (r: StoredReportFileJob) => { records.set(r.job.id, r); return true; }),
    finish: vi.fn(async (_claim: unknown, r: StoredReportFileJob) => { records.set(r.job.id, r); return true; }),
  };
  const pin = { stableName: 'pdf-create', versionId: 'published-1', digest: hash('SKILL.md') };
  const bytes = Buffer.from('%PDF-real-runtime-result');
  const runtime = { pin: vi.fn(async () => pin),
    accept: vi.fn(async (_record: StoredReportFileJob, _source: unknown, saveThread: (id: string) => Promise<void>) => { await saveThread('thr-1'); return { threadId: 'thr-1', runId: 'real-run-1' }; }),
    read: vi.fn(async () => ({ status: 'succeeded' as const, attachmentId: 'att-1', filename: 'report.pdf', bytes })),
    download: vi.fn(async () => ({ filename: 'report.pdf', mime: 'application/pdf', bytes })),
  };
  const service = new ReportFileService({ store, runtime,
    validator: { validate: vi.fn(async () => undefined) }, sources: [{ kind: 'interview', read: async () => snapshot }],
    newId: () => 'job-1', now: () => '2026-10-13T00:00:00Z' });
  const request = { source: { kind: 'interview' as const, id: snapshot.id, reportVersion: snapshot.reportVersion, reportHash: snapshot.reportHash }, format: 'pdf' as const, requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a' };
  return { actor, service, store, records, runtime, request, setSnapshot: (next: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...next }; } };
}
it('replays the same request without dispatching twice and refuses a different representation', async () => {
  const f = fixture();
  expect(await f.service.start(f.actor, f.request)).toEqual(await f.service.start(f.actor, f.request));
  expect(f.store.insert).toHaveBeenCalledTimes(1);
  await expect(f.service.start(f.actor, { ...f.request, format: 'pptx' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});
it('persists verified real bytes before exposing success and rechecks current document identity on download', async () => {
  const f = fixture(); const job = await f.service.start(f.actor, f.request);
  await f.service.tick(f.actor, job.id);
  expect((await f.service.status(f.actor, job.id)).status).toBe('succeeded');
  const file = await f.service.download(f.actor, job.id);
  expect(Buffer.from(file.bytes).toString()).toBe('%PDF-real-runtime-result');
  f.setSnapshot({ bindingKey: 'revision-2/document-2/1' });
  await expect(f.service.download(f.actor, job.id)).rejects.toMatchObject({ code: 'REPORT_CHANGED' });
});
it('does not reuse files when review/evidence notices change without changing report content', async () => {
  const f = fixture(); const job = await f.service.start(f.actor, f.request); await f.service.tick(f.actor, job.id);
  f.setSnapshot({ notices: ['模拟样本，尚未批准'] });
  await expect(f.service.status(f.actor, job.id)).rejects.toMatchObject({ code: 'REPORT_CHANGED' });
});
it('never reports success when the persisted object read-back is corrupted', async () => {
  const f = fixture(); const job = await f.service.start(f.actor, f.request);
  f.runtime.download.mockResolvedValue({ filename: 'report.pdf', mime: 'application/pdf', bytes: Buffer.from('corrupt') });
  await expect(f.service.download(f.actor, job.id)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
});
it('refuses a request ID owned by another actor instead of exposing their file', async () => {
  const f = fixture(); await f.service.start(f.actor, f.request);
  await expect(f.service.start({ ...f.actor, userId: 'user-2' }, f.request)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  await expect(f.service.status({ ...f.actor, userId: 'user-2' }, 'job-1')).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
});
