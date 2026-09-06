import { z } from 'zod';
import { NativeSessionResolveInput } from './native-session-binding';
export const NATIVE_ARTIFACT_TOOL = 'wx_artifact_publish';
export const NativeArtifactPublishInput = z.object({
 workspacePath:z.string().max(1024).regex(/^\/workspace\/.+/),
 title:z.string().min(1).max(200).regex(/^[^/\\\u0000-\u001f]+$/),
 mediaType:z.enum(['application/pdf','image/png','image/jpeg','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']),
 idempotencyKey:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
}).strict();
export const NativeArtifactStageInput=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:z.string().uuid(),toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolArgs:NativeArtifactPublishInput}).strict();
export const NativeArtifactStaged=z.object({publishId:z.string().uuid(),status:z.literal('staged'),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative()}).strict();
