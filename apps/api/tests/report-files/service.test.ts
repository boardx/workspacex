import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ReportFileService } from '../../src/application/report-files/service';
import { toOrgId } from '../../src/domain/org-id';
import type { StoredReportFileJob } from '../../src/application/report-files/job-ports';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const actor = { orgId: toOrgId('org-1'), userId: 'user-1' };
  let snapshot = { kind: 'interview' as const, id: 'report-1', title: '报告', reportVersion: 1,
    markdown: '# 报告\n正文', reportHash: hash('# 报告\n正文'), bindingKey: 'revision-1/document-1/1', projectId: null as string | null, notices: [] as string[] };
  const records = new Map<string, StoredReportFileJob>();
  const store = {
    findReusable: vi.fn(async (key: import("../../src/application/report-files/job-ports").ReportFileReuseKey) => [...records.values()].find(r => r.actor.orgId===key.actor.orgId && r.actor.userId===key.actor.userId && r.job.status!=="failed" && r.bindingKey===key.bindingKey && r.renderHash===key.renderHash && r.job.format===key.format && JSON.stringify(r.job.source)===JSON.stringify(key.source)) ?? null),
    findByRequest: vi.fn(async (who: typeof actor, id: string) => [...records.values()].find(r => r.requestId === id && r.actor.orgId === who.orgId && r.actor.userId === who.userId) ?? null),
    insert: vi.fn(async (r: StoredReportFileJob) => { if ([...records.values()].some(x => x.requestId === r.requestId)) return false; records.set(r.job.id, r); return true; }),
    get: vi.fn(async (who: typeof actor, id: string) => { const r = records.get(id); return r?.actor.userId === who.userId && r.actor.orgId === who.orgId ? r : null; }),
    claim: vi.fn(async (_who: typeof actor, id: string) => { const record = records.get(id)!; return record.job.status === 'queued' ? { record, leaseToken: 'lease-1' } : null; }),
    saveThread: vi.fn(async (claim: {record:StoredReportFileJob}, threadId: string) => { const r = records.get(claim.record.job.id)!; records.set(r.job.id, { ...r, threadId }); return true; }),
    invalidateFile: vi.fn(async (r:StoredReportFileJob)=>{records.set(r.job.id,{...r,job:{id:r.job.id,source:r.job.source,format:r.job.format,createdAt:r.job.createdAt,status:'failed',errorCode:'INVALID_FILE'}});return true;}),
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
  let nextId=0;
  const service = new ReportFileService({ store, runtime,
    validator: { validate: vi.fn(async () => undefined) }, sources: [{ kind: 'interview', read: async () => snapshot }],
    newId: () => `job-${++nextId}`, now: () => '2026-10-13T00:00:00Z' });
  const request = { source: { kind: 'interview' as const, id: snapshot.id, reportVersion: snapshot.reportVersion, reportHash: snapshot.reportHash }, format: 'pdf' as const, requestId: '2cd11bc4-bc03-4c39-ad14-c290a6074d9a' };
  return { actor, service, store, records, runtime, request, setSnapshot: (next: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...next }; } };
}
it('replays the same request without dispatching twice and refuses a different representation', async () => {
  const f = fixture();
  expect(await f.service.start(f.actor, f.request)).toEqual(await f.service.start(f.actor, f.request));
  expect(f.store.insert).toHaveBeenCalledTimes(1);
  await expect(f.service.start(f.actor, { ...f.request, format: 'docx' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
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

it('invalidates an export when its authorized project context changes', async () => {
  const f = fixture(); const job = await f.service.start(f.actor, f.request);
  f.setSnapshot({ projectId: 'different-project' });
  await expect(f.service.download(f.actor, job.id)).rejects.toMatchObject({ code: 'REPORT_CHANGED' });
});

it('reuses a completed current file across fresh request IDs without another Skill run',async()=>{
 const f=fixture();const first=await f.service.start(f.actor,f.request);
 const again=await f.service.start(f.actor,{...f.request,requestId:'3cd11bc4-bc03-4c39-ad14-c290a6074d9a'});
 expect(again.id).toBe(first.id);expect(f.runtime.accept).toHaveBeenCalledTimes(1);expect(f.runtime.pin).toHaveBeenCalledTimes(1);
});
it('reuses in-flight work across fresh request IDs instead of dispatching another run',async()=>{
 const f=fixture();f.runtime.read.mockResolvedValue({status:'pending'} as never);
 await f.service.start(f.actor,f.request);
 await f.service.start(f.actor,{...f.request,requestId:'3cd11bc4-bc03-4c39-ad14-c290a6074d9a'});
 expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});
it('does not expose cached success when its stored attachment is missing or corrupt',async()=>{
 const f=fixture();await f.service.start(f.actor,f.request);
 f.runtime.download.mockRejectedValue(new Error('missing attachment'));
 await expect(f.service.start(f.actor,{...f.request,requestId:'3cd11bc4-bc03-4c39-ad14-c290a6074d9a'})).rejects.toThrow();
 expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});

it('generates a new file only after the current report or rendering notices change',async()=>{
 const f=fixture();const first=await f.service.start(f.actor,f.request);
 f.setSnapshot({notices:['尚未批准，模拟材料']});
 const second=await f.service.start(f.actor,{...f.request,requestId:'3cd11bc4-bc03-4c39-ad14-c290a6074d9a'});
 expect(second.id).not.toBe(first.id);expect(f.runtime.accept).toHaveBeenCalledTimes(2);
 const markdown='# 报告\n新版正文';f.setSnapshot({reportVersion:2,markdown,reportHash:hash(markdown),bindingKey:'revision-1/document-2/2'});
 const third=await f.service.start(f.actor,{...f.request,source:{...f.request.source,reportVersion:2,reportHash:hash(markdown)},requestId:'4cd11bc4-bc03-4c39-ad14-c290a6074d9a'});
 expect(third.id).not.toBe(second.id);expect(f.runtime.accept).toHaveBeenCalledTimes(3);
});

it('invalidates proven corrupt cached bytes so a subsequent request can recover, but not on transient storage errors',async()=>{
 const f=fixture();await f.service.start(f.actor,f.request);
 f.runtime.download.mockRejectedValueOnce(new Error('temporary outage'));
 await expect(f.service.start(f.actor,{...f.request,requestId:'3cd11bc4-bc03-4c39-ad14-c290a6074d9a'})).rejects.toThrow();
 expect(f.store.invalidateFile).not.toHaveBeenCalled();
 f.runtime.download.mockResolvedValueOnce({filename:'report.pdf',mime:'application/pdf',bytes:Buffer.from('broken')});
 await expect(f.service.start(f.actor,{...f.request,requestId:'4cd11bc4-bc03-4c39-ad14-c290a6074d9a'})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
 expect(f.store.invalidateFile).toHaveBeenCalledTimes(1);
 const recovered=await f.service.start(f.actor,{...f.request,requestId:'5cd11bc4-bc03-4c39-ad14-c290a6074d9a'});
 expect(recovered.status).toBe('succeeded');expect(f.runtime.accept).toHaveBeenCalledTimes(2);
});
