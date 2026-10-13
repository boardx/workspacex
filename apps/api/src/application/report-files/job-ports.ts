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
  readonly objectKey?: string;
}
export interface ClaimedReportFileJob { readonly record: StoredReportFileJob; readonly leaseToken: string }
export interface ReportFileJobStore {
  findByRequest(actor: ReportFileActor, requestId: string): Promise<StoredReportFileJob | null>;
  insert(record: StoredReportFileJob): Promise<boolean>;
  get(actor: ReportFileActor, id: string): Promise<StoredReportFileJob | null>;
  claim(actor: ReportFileActor, id: string): Promise<ClaimedReportFileJob | null>;
  renew(claim: ClaimedReportFileJob): Promise<boolean>;
  finish(claim: ClaimedReportFileJob, result: StoredReportFileJob): Promise<boolean>;
}
export interface ReportFileSkillRuntime {
  pin(actor: ReportFileActor, format: FileRequest['format']): Promise<SkillPin>;
  generate(input: { actor: ReportFileActor; snapshot: ReportFileSourceSnapshot; pin: SkillPin; format: FileRequest['format']; jobId: string; assertCurrent: () => Promise<void> }): Promise<{ bytes: Uint8Array; filename: string }>;
}
export interface ReportFileValidator {
  validate(format: FileRequest['format'], bytes: Uint8Array): Promise<void>;
}
export type GeneratedFile = z.infer<typeof ReportGeneratedFile>;
