import {z} from 'zod';
import {SkillPackagePath} from './standard-capabilities';
import {limits} from './sandbox-session';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
export const SKILL_DRAFT_TOOL='wx_skill_create_draft';
export const SKILL_DRAFT_LIMITS={maxFiles:limits.maxFiles,maxBytes:limits.maxFileBytes,responseBytes:32768} as const;
export const SkillDraftInput=z.object({
 stableName:z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),name:z.string().min(1).max(255),description:z.string().min(1).max(4096),semanticVersion:z.string().regex(/^\d+\.\d+\.\d+$/),
 files:z.array(z.object({workspacePath:z.string().startsWith('/workspace/').max(4096),packagePath:SkillPackagePath}).strict()).min(1).max(SKILL_DRAFT_LIMITS.maxFiles),
 inputSchema:z.record(z.unknown()),outputSchema:z.record(z.unknown()),
 dependencies:z.array(z.object({runtime:z.enum(['node','python']),packages:z.array(z.object({name:z.string().min(1).max(128),version:z.string().min(1).max(128)}).strict()).max(128)}).strict()).max(2),
}).strict();
export const SkillDraftOutput=z.object({status:z.literal('artifact_draft'),workspacePath:z.string().regex(/^\/workspace\/skill-draft-[a-f0-9]{64}\.json$/),packId:z.string(),packVersion:z.string(),packDigest:z.string().regex(/^[a-f0-9]{64}$/),fileDigest:z.string().regex(/^[a-f0-9]{64}$/),validationReport:z.object({packageIntegrity:z.literal('verified'),fileCount:z.number().int().positive(),dependencyExecution:z.literal('not_verified'),fixtureExecution:z.literal('not_run'),publication:z.literal('admin_import_required')}).strict()}).strict();
export const SkillDraftInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(SKILL_DRAFT_TOOL),toolArgs:SkillDraftInput}).strict();
export const SkillArtifactImportInput=z.object({artifactId:z.string().min(1).max(256),version:z.number().int().positive(),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().min(1).max(255)}).strict();
