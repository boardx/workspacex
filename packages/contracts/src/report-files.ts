import { z } from 'zod';
import { AgentRunStatus } from './wave2-runtime';

/** Existing product Skill identities and their requested file representations. */
export const REPORT_FILE_FORMATS = {
  pdf: { skillStableName: 'pdf-create', extension: '.pdf', mediaType: 'application/pdf' },
  docx: { skillStableName: 'docx-create', extension: '.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
} as const;
type ReportFormatKey = keyof typeof REPORT_FILE_FORMATS;
export const ReportFileFormat = z.enum(Object.keys(REPORT_FILE_FORMATS) as [ReportFormatKey, ...ReportFormatKey[]]);
export const ReportFileSourceKind = z.enum(['research', 'interview']);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const ReportFileSource = z.object({
  kind: ReportFileSourceKind, id: z.string().min(1).max(256),
  reportVersion: z.number().int().nonnegative(), reportHash: sha256,
}).strict();
export const ReportFileRequest = z.object({
  source: ReportFileSource, format: ReportFileFormat, requestId: z.string().uuid(),
}).strict();
export const ReportFileErrorCode = z.enum([
  'REPORT_NOT_FOUND', 'REPORT_UNAVAILABLE', 'REPORT_CHANGED', 'IDEMPOTENCY_CONFLICT',
  'SKILL_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'SANDBOX_TIMEOUT',
  'SCRIPT_FAILED_AFTER_RETRIES', 'INVALID_FILE', 'STORAGE_UNAVAILABLE', 'GENERATION_FAILED',
]);
export const ReportFileSkillPin = z.object({
  stableName: z.string().min(1), versionId: z.string().min(1), digest: sha256,
}).strict();
export const ReportGeneratedFile = z.object({
  filename: z.string().min(1).max(200).regex(/^[^/\\\r\n\x00]+$/),
  mediaType: z.string().min(1), sizeBytes: z.number().int().positive().max(30 * 1024 * 1024), sha256,
}).strict();
const base = z.object({ id: z.string().min(1), source: ReportFileSource, format: ReportFileFormat, createdAt: z.string().datetime(), execution: z.object({ runId: z.string().min(1), threadId: z.string().min(1), status: AgentRunStatus }).strict().optional() });
export const ReportFileJob = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('queued') }).strict(),
  base.extend({ status: z.literal('running') }).strict(),
  base.extend({ status: z.literal('failed'), errorCode: ReportFileErrorCode }).strict(),
  base.extend({ status: z.literal('succeeded'), skill: ReportFileSkillPin, file: ReportGeneratedFile }).strict(),
]).superRefine((job, ctx) => {
  if (job.status !== 'succeeded') return;
  const expected = REPORT_FILE_FORMATS[job.format];
  if (job.file.mediaType !== expected.mediaType || !job.file.filename.endsWith(expected.extension) || job.skill.stableName !== expected.skillStableName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'File representation must match the executed product Skill' });
  }
});
export const ReportFileSourceInfo = ReportFileSource.extend({ title: z.string().min(1).max(300), notices: z.array(z.string().max(4000)).max(256) }).strict();
export const operations = {
  source: { method: 'GET', path: '/report-files/sources/:kind/:id' },
  generate: { method: 'POST', path: '/report-files' },
  status: { method: 'GET', path: '/report-files/:jobId' },
  download: { method: 'GET', path: '/report-files/:jobId/download' },
} as const;
