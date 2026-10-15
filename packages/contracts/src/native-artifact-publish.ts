import { z } from 'zod';
import { NativeSessionResolveInput } from './native-session-binding';
export const NATIVE_ARTIFACT_TOOL = 'wx_artifact_publish';
export const NativeArtifactPublishInput = z.object({
 workspacePath:z.string().max(1024).regex(/^\/workspace\/.+/),
 title:z.string().min(1).max(200).regex(/^[^/\\\u0000-\u001f]+$/).describe("Download filename including an extension matching workspacePath and mediaType, for example meeting-minutes.md. A display title without an extension is rejected."),
 mediaType:z.enum(['application/pdf','image/png','image/jpeg','text/plain','text/html','text/markdown','text/csv','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']),
 idempotencyKey:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
}).strict();
export const NativeArtifactStageInput=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:z.string().uuid(),toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolArgs:NativeArtifactPublishInput}).strict();
export const REPORT_FILE_POST_PUBLISH_TOOLS=['read_file','ls','glob','grep','write_todos','wx_run_status'] as const;
export const ReportFileArtifactPolicy=z.object({jobId:z.string().uuid(),publication:NativeArtifactPublishInput,published:z.boolean()}).strict();
export type ReportFileArtifactPolicy=z.infer<typeof ReportFileArtifactPolicy>;
export const NativeArtifactStaged=z.object({publishId:z.string().uuid(),status:z.literal('staged'),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative(),completion:z.object({kind:z.literal('report-file'),jobId:z.string().uuid()}).strict().optional()}).strict();
