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
it('keeps the same report job and native run across approval waiting and verified completion', async () => {
 const f=fixture();
 f.runtime.read.mockResolvedValueOnce({status:'pending',execution:{runId:'real-run-1',threadId:'thr-1',status:'awaiting_tool_permission'}} as never);
 const waiting=await f.service.start(f.actor,f.request);
 expect(waiting).toMatchObject({status:'running',execution:{runId:'real-run-1',threadId:'thr-1',status:'awaiting_tool_permission'}});
 const resumed=await f.service.status(f.actor,waiting.id);
 expect(resumed).toMatchObject({id:waiting.id,status:'succeeded'});
 expect(f.records.get(waiting.id)?.runId).toBe('real-run-1');
 expect(f.runtime.accept).toHaveBeenCalledTimes(1); expect(f.store.insert).toHaveBeenCalledTimes(1);
});

it('persists actor-bound Credit guidance while repeat status reads never dispatch another conversion', async () => {
  const f = fixture();
  const creditFailure = { code: 'credit_required', ownerType: 'user', ownerId: f.actor.userId, rechargePath: '/billing?purchase=1' };
  f.runtime.read.mockResolvedValue({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure,
    execution: { runId: 'real-run-1', threadId: 'thr-1', status: 'failed' } } as never);
  const first = await f.service.start(f.actor, f.request);
  expect(first).toMatchObject({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure });
  expect(await f.service.status(f.actor, first.id)).toMatchObject({ creditFailure });
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
  expect(f.runtime.download).not.toHaveBeenCalled();
});

it('recovers typed guidance for a historical generic failure by reading the existing run only', async () => {
  const f = fixture();
  f.runtime.read.mockResolvedValue({ status: 'failed' } as never);
  const first = await f.service.start(f.actor, f.request);
  expect(first).toMatchObject({ errorCode: 'GENERATION_FAILED' });
  const creditFailure = { code: 'credit_required', ownerType: 'user', ownerId: f.actor.userId, rechargePath: '/billing?purchase=1' };
  f.runtime.read.mockResolvedValue({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure } as never);
  expect(await f.service.status(f.actor, first.id)).toMatchObject({ errorCode: 'CREDIT_REQUIRED', creditFailure });
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});
it('historical failures never resurrect a conversion or expose stale foreign payer metadata', async () => {
  const f = fixture();
  f.runtime.read.mockResolvedValue({ status: 'failed' } as never);
  const first = await f.service.start(f.actor, f.request);
  f.runtime.read.mockResolvedValue({ status: 'pending' } as never);
  expect(await f.service.status(f.actor, first.id)).toMatchObject({ status: 'failed', errorCode: 'GENERATION_FAILED' });
  const record = f.records.get(first.id)!;
  f.records.set(first.id, { ...record, job: { ...record.job, errorCode: 'CREDIT_REQUIRED', creditFailure: { code: 'credit_required', ownerType: 'user', ownerId: 'foreign', rechargePath: '/billing?purchase=1' } } } as never);
  const sanitized = await f.service.status(f.actor, first.id);
  expect(sanitized).toMatchObject({ errorCode: 'CREDIT_ACCOUNTING_UNAVAILABLE' });
  expect(sanitized).not.toHaveProperty('creditFailure');
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});
it('controller status serialization retains guidance while actor and report permissions remain enforced', async () => {
  const { ReportFilesController } = await import('../../src/interface/controllers/report-files.controller');
  const { ReportFileJob } = await import('@repo/contracts/report-files');
  const f = fixture();
  const creditFailure = { code: 'credit_required', ownerType: 'user', ownerId: f.actor.userId, rechargePath: '/billing?purchase=1' };
  f.runtime.read.mockResolvedValue({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure } as never);
  const first = await f.service.start(f.actor, f.request);
  const id = '00000000-0000-4000-8000-000000000001';
  f.records.set(id, f.records.get(first.id)!);
  const controller = new ReportFilesController(f.service);
  expect(ReportFileJob.parse(JSON.parse(JSON.stringify(await controller.status(f.actor, id))))).toMatchObject({ creditFailure });
  await expect(controller.status({ ...f.actor, userId: 'other-user' }, id)).rejects.toMatchObject({ status: 404 });
  await expect(controller.status({ ...f.actor, orgId: toOrgId('other-org') }, id)).rejects.toMatchObject({ status: 404 });
  f.setSnapshot({ bindingKey: 'revoked-source' });
  await expect(controller.status(f.actor, id)).rejects.toMatchObject({ status: 409 });
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
});

it('retains a typed Credit admission refusal before a run was accepted without guessing from arbitrary exceptions', async () => {
  const { CreditConsumptionError } = await import('../../src/application/billing/credit-consumption');
  const f = fixture();
  f.runtime.accept.mockRejectedValue(new CreditConsumptionError('credit_required', 'user', f.actor.userId));
  const job = await f.service.start(f.actor, f.request);
  expect(job).toMatchObject({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure: { ownerId: f.actor.userId, rechargePath: '/billing?purchase=1' } });
  expect(f.runtime.accept).toHaveBeenCalledTimes(1);
  expect(f.runtime.download).not.toHaveBeenCalled();
});

it('restoring a queued export with no accepted run is observation only, never initialization', async () => {
  const f = fixture(); const first = await f.service.start(f.actor, f.request);
  const { runId: _discarded, ...record } = f.records.get(first.id)!;
  f.records.set(first.id, { ...record, job: { id: first.id, source: first.source, format: first.format, createdAt: first.createdAt, status: 'queued' } });
  f.runtime.accept.mockClear(); f.store.claim.mockClear(); f.runtime.read.mockClear();
  expect(await f.service.status(f.actor, first.id, { observeOnly: true })).toMatchObject({ status: 'queued' });
  expect(f.runtime.accept).not.toHaveBeenCalled(); expect(f.store.claim).not.toHaveBeenCalled(); expect(f.runtime.read).not.toHaveBeenCalled();
});

it('real HTTP status restoration survives app restart with authority checks and no new conversion', async () => {
  const { Module } = await import('@nestjs/common');
  const { NestFactory, APP_GUARD } = await import('@nestjs/core');
  const { ReportFilesController } = await import('../../src/interface/controllers/report-files.controller');
  const { REPORT_FILE_SERVICE } = await import('../../src/application/report-files/service');
  const { PrincipalGuard } = await import('../../src/interface/guards/principal.guard');
  const { PRINCIPAL_RESOLVER_PORT } = await import('../../src/application/ports/principal-resolver.port');
  const { ReportFileJob } = await import('@repo/contracts/report-files');
  const f = fixture();
  const creditFailure = { code: 'credit_required', ownerType: 'user', ownerId: f.actor.userId, rechargePath: '/billing?purchase=1' };
  f.runtime.read.mockResolvedValue({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure } as never);
  const first = await f.service.start(f.actor, f.request);
  const id = '00000000-0000-4000-8000-000000000001'; f.records.set(id, f.records.get(first.id)!);
  f.runtime.accept.mockClear();
  for (let restart = 0; restart < 2; restart++) {
    class Fixture {}
    Module({ controllers: [ReportFilesController], providers: [
      { provide: REPORT_FILE_SERVICE, useValue: f.service },
      { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string,string>) => {
        const user = headers.authorization?.replace('Bearer ', '');
        return user === 'owner' ? f.actor : user === 'peer' ? { ...f.actor, userId: 'peer' }
          : user === 'foreign' ? { ...f.actor, orgId: toOrgId('foreign-org') } : null;
      } } }, { provide: APP_GUARD, useClass: PrincipalGuard },
    ] })(Fixture);
    const app = await NestFactory.create(Fixture, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') throw new Error('missing fixture address');
      const url = `http://127.0.0.1:${address.port}/report-files/${id}?observeOnly=true`;
      expect((await fetch(url)).status).toBe(401);
      for (const user of ['peer', 'foreign']) expect((await fetch(url, { headers: { authorization: `Bearer ${user}` } })).status).toBe(404);
      const response = await fetch(url, { headers: { authorization: 'Bearer owner' } });
      expect(response.status).toBe(200);
      expect(ReportFileJob.parse(await response.json())).toMatchObject({ creditFailure });
      expect((await fetch(url.replace('observeOnly=true', 'observeOnly=false'), { headers: { authorization: 'Bearer owner' } })).status).toBe(400);
    } finally { await app.close(); }
  }
  expect(f.runtime.accept).not.toHaveBeenCalled(); expect(f.runtime.download).not.toHaveBeenCalled();
});
