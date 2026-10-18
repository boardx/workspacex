import type { z } from 'zod';
import type { ReportFileJob, ReportFileRequest, ReportFileSkillPin, ReportGeneratedFile } from '@repo/contracts/report-files';
import type { ReportFileActor, ReportFileSourceSnapshot } from './ports';
export type FileJob = z.infer<typeof ReportFileJob>;
export type FileRequest = z.infer<typeof ReportFileRequest>;
export type SkillPin = z.infer<typeof ReportFileSkillPin>;
export interface StoredReportFileJob {
  readonly actor: ReportFileActor;
  readonly requestId: string;
  readonly job: FileJob;
  readonly bindingKey: string;
  readonly renderHash: string;
  readonly skill: SkillPin;
  readonly projectId?: string | null;
  readonly threadId?: string;
  readonly runId?: string;
  readonly attachmentId?: string;
}
export interface ClaimedReportFileJob { readonly record: StoredReportFileJob; readonly leaseToken: string }
export interface ReportFileReuseKey {
  readonly actor: ReportFileActor; readonly source: FileRequest["source"]; readonly format: FileRequest["format"];
  readonly bindingKey: string; readonly renderHash: string;
}
export interface ReportFileJobStore {
  findReusable(key: ReportFileReuseKey): Promise<StoredReportFileJob | null>;
  findByRequest(actor: ReportFileActor, requestId: string): Promise<StoredReportFileJob | null>;
  insert(record: StoredReportFileJob): Promise<boolean>;
  get(actor: ReportFileActor, id: string): Promise<StoredReportFileJob | null>;
  claim(actor: ReportFileActor, id: string): Promise<ClaimedReportFileJob | null>;
  saveThread(claim: ClaimedReportFileJob, threadId: string): Promise<boolean>;
  update(record: StoredReportFileJob): Promise<boolean>;
  finish(claim: ClaimedReportFileJob, result: StoredReportFileJob): Promise<boolean>;
}
/** Thin adapter to existing Chat acceptance, AgentRun reads and attachment download. */
export interface ReportFileChatRuntime {
  pin(actor: ReportFileActor, format: FileRequest['format']): Promise<SkillPin>;
  accept(record: StoredReportFileJob, source: ReportFileSourceSnapshot, saveThread: (threadId: string) => Promise<void>): Promise<{ threadId: string; runId: string }>;
  read(record: StoredReportFileJob): Promise<({ status: 'pending' } | { status: 'failed' } | { status: 'succeeded'; attachmentId: string; filename: string; bytes: Uint8Array }) & { execution?: NonNullable<FileJob['execution']> }>;
  download(record: StoredReportFileJob): Promise<{ filename: string; mime: string; bytes: Uint8Array }>;
}
export interface ReportFileValidator {
  validate(format: FileRequest['format'], bytes: Uint8Array, source: ReportFileSourceSnapshot): Promise<void>;
}
export type GeneratedFile = z.infer<typeof ReportGeneratedFile>;
