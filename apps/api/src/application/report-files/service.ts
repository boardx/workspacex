import { createHash, randomUUID } from 'node:crypto';
import { ReportFileJob, ReportFileRequest, REPORT_FILE_FORMATS, type ReportFileErrorCode } from '@repo/contracts/report-files';
import type { z } from 'zod';
import { ReportFileSourceError, type ReportFileActor, type ReportFileSourceResolver, type ReportFileSourceSnapshot } from './ports';
import type { FileJob, FileRequest, ReportFileJobStore, ReportFileChatRuntime, ReportFileValidator, StoredReportFileJob } from './job-ports';
export const REPORT_FILE_SERVICE = Symbol('ReportFileService');
export class ReportFileError extends Error {
  constructor(readonly code: z.infer<typeof ReportFileErrorCode>) { super(code); }
}
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function reportRenderHash(snapshot: ReportFileSourceSnapshot): string {
  return sha(JSON.stringify([snapshot.title, snapshot.markdown, snapshot.appendixMarkdown ?? '', snapshot.notices, snapshot.projectId]));
}
export interface ReportFileServiceDeps {
  readonly store: ReportFileJobStore;
  readonly runtime: ReportFileChatRuntime;
  readonly validator: ReportFileValidator;
  readonly sources: readonly ReportFileSourceResolver[];
  readonly newId?: () => string;
  readonly now?: () => string;
}
/** Report-version binding only. Existing Chat/AgentRun owns execution, permissions, billing and files. */
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
      await this.tick(actor, previous.job.id);
      return this.status(actor, previous.job.id);
    }
    const reuseKey = { actor, source: request.source, format: request.format, bindingKey: snapshot.bindingKey, renderHash: reportRenderHash(snapshot) };
    const reusable = await this.deps.store.findReusable(reuseKey);
    if (reusable) {
      const job = await this.status(actor, reusable.job.id);
      if (job.status === "succeeded") await this.download(actor, job.id);
      if (job.status !== "failed") return job;
    }
    const skill = await this.deps.runtime.pin(actor, request.format);
    if (skill.stableName !== REPORT_FILE_FORMATS[request.format].skillStableName) throw new ReportFileError('SKILL_UNAVAILABLE');
    const record: StoredReportFileJob = { actor, projectId: snapshot.projectId, requestId: request.requestId, bindingKey: snapshot.bindingKey, renderHash: reportRenderHash(snapshot), skill,
      job: { id: (this.deps.newId ?? randomUUID)(), source: request.source, format: request.format, status: 'queued', createdAt: (this.deps.now ?? (() => new Date().toISOString()))() } };
    if (!await this.deps.store.insert(record)) {
      const raced = await this.deps.store.findByRequest(actor, request.requestId);
      if (!raced && !await this.deps.store.findReusable(reuseKey)) throw new ReportFileError('IDEMPOTENCY_CONFLICT');
      return this.start(actor, request);
    }
    await this.tick(actor, record.job.id);
    return this.status(actor, record.job.id);
  }
  async status(actor: ReportFileActor, id: string): Promise<FileJob> {
    let record = await this.readCurrent(actor, id);
    if (!record.runId && record.job.status !== 'failed') {
      await this.tick(actor, id);
      record = await this.readCurrent(actor, id);
    }
    if (!record.runId || record.job.status === 'failed' || record.job.status === 'succeeded') return ReportFileJob.parse(record.job);
    const result = await this.deps.runtime.read(record);
    record = { ...record, job: ReportFileJob.parse({ ...record.job, ...(result.execution ? { execution: result.execution } : {}) }) };
    if (result.status === 'pending') return ReportFileJob.parse(record.job);
    if (result.status === 'failed') {
      record = { ...record, job: { ...record.job, status: 'failed', errorCode: 'GENERATION_FAILED' } };
    } else {
      const snapshot = await this.source(actor, record.job.source);
      this.matchRecord(snapshot, record);
      try {
        await this.deps.validator.validate(record.job.format, result.bytes, snapshot);
        record = { ...record, attachmentId: result.attachmentId, job: ReportFileJob.parse({ ...record.job, status: 'succeeded', skill: record.skill,
          file: { filename: result.filename, mediaType: REPORT_FILE_FORMATS[record.job.format].mediaType, sizeBytes: result.bytes.byteLength, sha256: sha(result.bytes) } }) };
      } catch {
        record = { ...record, job: { ...record.job, status: 'failed', errorCode: 'INVALID_FILE' } };
      }
    }
    await this.readCurrent(actor, id);
    await this.deps.store.update(record);
    return ReportFileJob.parse(record.job);
  }
  async download(actor: ReportFileActor, id: string) {
    const record = await this.readCurrent(actor, id);
    if (record.job.status !== 'succeeded' || !record.attachmentId) throw new ReportFileError('REPORT_UNAVAILABLE');
    const content = await this.deps.runtime.download(record);
    const file = record.job.file;
    if (content.filename !== file.filename || content.mime !== file.mediaType || content.bytes.byteLength !== file.sizeBytes || sha(content.bytes) !== file.sha256) throw new ReportFileError('STORAGE_UNAVAILABLE');
    await this.readCurrent(actor, id);
    return { bytes: content.bytes, file };
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
  /** Initialization lease protects only the linkage; it never executes or meters a model. */
  async tick(actor: ReportFileActor, id: string) {
    const current = await this.readCurrent(actor, id);
    if (current.runId || current.job.status === 'failed' || current.job.status === 'succeeded') return;
    const claim = await this.deps.store.claim(actor, id);
    if (!claim) return;
    let threadId = claim.record.threadId;
    try {
      const snapshot = await this.source(actor, claim.record.job.source);
      this.matchRecord(snapshot, claim.record);
      const link = await this.deps.runtime.accept(claim.record, snapshot, async value => {
        if (!await this.deps.store.saveThread(claim, value)) throw new ReportFileError('GENERATION_FAILED');
        threadId = value;
      });
      await this.readCurrent(actor, id);
      await this.deps.store.finish(claim, { ...claim.record, ...link, job: { ...claim.record.job, status: 'running', execution: { ...link, status: 'queued' } } });
    } catch (error) {
      const code = error instanceof ReportFileError || error instanceof ReportFileSourceError ? error.code : 'GENERATION_FAILED';
      await this.deps.store.finish(claim, { ...claim.record, threadId, job: { ...claim.record.job, status: 'failed', errorCode: code } });
    }
  }
}
