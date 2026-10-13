import { createHash, randomUUID } from 'node:crypto';
import { ReportFileJob, ReportFileRequest, REPORT_FILE_FORMATS, type ReportFileErrorCode } from '@repo/contracts/report-files';
import type { z } from 'zod';
import type { ObjectStore } from '../artifact/ports';
import { ReportFileSourceError, type ReportFileActor, type ReportFileSourceResolver, type ReportFileSourceSnapshot } from './ports';
import type { ClaimedReportFileJob, FileJob, FileRequest, ReportFileJobStore, ReportFileSkillRuntime, ReportFileValidator, StoredReportFileJob } from './job-ports';
export const REPORT_FILE_SERVICE = Symbol('ReportFileService');
export class ReportFileError extends Error {
  constructor(readonly code: z.infer<typeof ReportFileErrorCode>) { super(code); }
}
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function reportRenderHash(snapshot: ReportFileSourceSnapshot): string {
  return sha(JSON.stringify([snapshot.title, snapshot.markdown, snapshot.appendixMarkdown ?? '', snapshot.notices]));
}
export interface ReportFileServiceDeps {
  readonly store: ReportFileJobStore;
  readonly objects: ObjectStore;
  readonly runtime: ReportFileSkillRuntime;
  readonly validator: ReportFileValidator;
  readonly sources: readonly ReportFileSourceResolver[];
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly autostart?: boolean;
}
/** One report-specific adapter over existing product Skills; no document renderer here. */
export class ReportFileService {
  constructor(private readonly deps: ReportFileServiceDeps) {}
  async source(actor: ReportFileActor, source: Pick<FileRequest['source'], 'kind' | 'id'>): Promise<ReportFileSourceSnapshot> {
    const resolver = this.deps.sources.find(item => item.kind === source.kind);
    if (!resolver) throw new ReportFileError('REPORT_UNAVAILABLE');
    const result = await resolver.read(actor, source.id);
    if (result.kind !== source.kind || result.id !== source.id || !result.markdown.trim() || sha(result.markdown) !== result.reportHash) throw new ReportFileError('REPORT_UNAVAILABLE');
    return result;
  }
  async start(actor: ReportFileActor, raw: FileRequest): Promise<FileJob> {
    const request = ReportFileRequest.parse(raw);
    const snapshot = await this.source(actor, request.source);
    this.matchRequest(snapshot, request.source);
    const previous = await this.deps.store.findByRequest(actor, request.requestId);
    if (previous) {
      if (previous.job.format !== request.format || JSON.stringify(previous.job.source) !== JSON.stringify(request.source) || previous.bindingKey !== snapshot.bindingKey || previous.renderHash !== reportRenderHash(snapshot)) throw new ReportFileError('IDEMPOTENCY_CONFLICT');
      this.kick(actor, previous.job.id);
      return ReportFileJob.parse(previous.job);
    }
    const skill = await this.deps.runtime.pin(actor, request.format);
    if (skill.stableName !== REPORT_FILE_FORMATS[request.format].skillStableName) throw new ReportFileError('SKILL_UNAVAILABLE');
    const record: StoredReportFileJob = { actor, requestId: request.requestId, bindingKey: snapshot.bindingKey, renderHash: reportRenderHash(snapshot), skill,
      job: { id: (this.deps.newId ?? randomUUID)(), source: request.source, format: request.format, status: 'queued', createdAt: (this.deps.now ?? (() => new Date().toISOString()))() } };
    if (!await this.deps.store.insert(record)) {
      const raced = await this.deps.store.findByRequest(actor, request.requestId);
      if (!raced) throw new ReportFileError('IDEMPOTENCY_CONFLICT');
      return this.start(actor, request);
    }
    this.kick(actor, record.job.id);
    return ReportFileJob.parse(record.job);
  }
  async status(actor: ReportFileActor, id: string) {
    const record = await this.readCurrent(actor, id);
    this.kick(actor, id);
    return ReportFileJob.parse(record.job);
  }
  async download(actor: ReportFileActor, id: string) {
    const record = await this.readCurrent(actor, id);
    if (record.job.status !== 'succeeded' || !record.objectKey) throw new ReportFileError('REPORT_UNAVAILABLE');
    const bytes = await this.readBytes(record.objectKey, record.job.file.sha256, record.job.file.sizeBytes, record.job.file.mediaType);
    await this.readCurrent(actor, id);
    return { bytes, file: record.job.file };
  }
  private async readCurrent(actor: ReportFileActor, id: string) {
    const record = await this.deps.store.get(actor, id);
    if (!record || record.actor.orgId !== actor.orgId || record.actor.userId !== actor.userId) throw new ReportFileError('REPORT_NOT_FOUND');
    const snapshot = await this.source(actor, record.job.source);
    this.matchRecord(snapshot, record);
    return record;
  }
  private matchRequest(snapshot: ReportFileSourceSnapshot, source: FileRequest['source']) {
    if (source.reportVersion !== snapshot.reportVersion || source.reportHash !== snapshot.reportHash) throw new ReportFileError('REPORT_CHANGED');
  }
  private matchRecord(snapshot: ReportFileSourceSnapshot, record: StoredReportFileJob) {
    this.matchRequest(snapshot, record.job.source);
    if (snapshot.bindingKey !== record.bindingKey || reportRenderHash(snapshot) !== record.renderHash) throw new ReportFileError('REPORT_CHANGED');
  }
  private kick(actor: ReportFileActor, id: string) {
    if (this.deps.autostart === false) return;
    // Claims and terminal writes are persistent and fenced. A rejected kick never leaks report data.
    void this.tick(actor, id).catch(() => undefined);
  }
  async tick(actor: ReportFileActor, id: string) {
    const claim = await this.deps.store.claim(actor, id);
    if (!claim) return;
    let lost = false;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.deps.store.renew(claim).then(ok => { if (!ok) lost = true; }, () => { lost = true; }).finally(() => { renewing = false; });
    }, 15_000);
    try {
      const assertCurrent = async () => {
        if (lost || !await this.deps.store.renew(claim)) throw new LeaseLost();
        await this.readCurrent(actor, id);
      };
      await assertCurrent();
      const snapshot = await this.source(actor, claim.record.job.source);
      this.matchRecord(snapshot, claim.record);
      const result = await this.deps.runtime.generate({ actor, snapshot, pin: claim.record.skill, format: claim.record.job.format, jobId: id, assertCurrent });
      await this.deps.validator.validate(claim.record.job.format, result.bytes);
      const format = REPORT_FILE_FORMATS[claim.record.job.format];
      const file = { filename: result.filename, mediaType: format.mediaType, sizeBytes: result.bytes.byteLength, sha256: sha(result.bytes) };
      const job = ReportFileJob.parse({ ...claim.record.job, status: 'succeeded', skill: claim.record.skill, file });
      await assertCurrent();
      const objectKey = `report-files/${actor.orgId}/${id}/${claim.leaseToken}/${file.filename}`;
      try {
        await this.deps.objects.putOnce(objectKey, result.bytes, file.mediaType);
        await this.readBytes(objectKey, file.sha256, file.sizeBytes, file.mediaType);
      } catch { throw new ReportFileError('STORAGE_UNAVAILABLE'); }
      await assertCurrent();
      if (!await this.deps.store.finish(claim, { ...claim.record, job, objectKey })) throw new LeaseLost();
    } catch (error) {
      if (error instanceof LeaseLost || lost) return;
      const code = error instanceof ReportFileError || error instanceof ReportFileSourceError ? error.code : 'GENERATION_FAILED';
      await this.deps.store.finish(claim, { ...claim.record, job: { ...this.base(claim), status: 'failed', errorCode: code } });
    } finally { clearInterval(heartbeat); }
  }
  private base(claim: ClaimedReportFileJob) {
    const { id, source, format, createdAt } = claim.record.job;
    return { id, source, format, createdAt };
  }
  private async readBytes(key: string, hash: string, size: number, mime: string): Promise<Uint8Array> {
    const bytes = await this.deps.objects.get(key);
    const head = await this.deps.objects.head(key);
    if (!bytes || !head || head.sizeBytes !== size || head.mime !== mime || bytes.byteLength !== size || sha(bytes) !== hash) throw new ReportFileError('STORAGE_UNAVAILABLE');
    return bytes;
  }
}
class LeaseLost extends Error {}
