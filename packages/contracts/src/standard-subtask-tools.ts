import {z} from 'zod';
import {KnowledgeReadInput,STANDARD_CONTEXT_LIMITS} from './standard-context-tools';
import {NativeSessionResolveInput} from './native-session-binding';
import {SubtaskRunStatus,SubtaskOutputFilesPolicy} from './subtask-run';
export const STANDARD_SUBTASK_TOOL='spawn_async_task';
export const STANDARD_SUBTASK_LIMITS={maxRefs:8,maxRefChars:4096,maxDescriptionChars:8000,maxContextBytes:STANDARD_CONTEXT_LIMITS.maxReadBytes,deadlineMs:30000,maxResponseBytes:16384} as const;
export const NATIVE_SUBTASK_CONTEXT_PREFIX='wsx:native-subtask:v1:';
export const SubtaskSpawnInput=z.object({description:z.string().trim().min(1).max(STANDARD_SUBTASK_LIMITS.maxDescriptionChars),
 contextRefs:z.array(z.string().min(1).max(STANDARD_SUBTASK_LIMITS.maxRefChars).describe('JSON string copied from a real knowledge result, e.g. {"sourceId":"chat-attachment:ID","versionId":"sha256:HASH"}; optional projectId must be authorized. No orgId/userId or URL.')).max(STANDARD_SUBTASK_LIMITS.maxRefs).optional(),
 outputFiles:SubtaskOutputFilesPolicy.optional().describe('Explicit governed file budget. Omission keeps the child text-only.'),
 idempotencyKey:z.string().min(1).max(256).describe('Stable logical dispatch key; reuse only for the identical description, context references, and output policy.')}).strict();
export const SubtaskSpawnOutput=z.object({childRunId:z.string().min(1),status:z.union([z.literal('queued'),SubtaskRunStatus.exclude(['pending'])])}).strict();
export const SubtaskSpawnInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:z.string().uuid(),toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(STANDARD_SUBTASK_TOOL),toolArgs:SubtaskSpawnInput}).strict();
export const NativeSubtaskContext=z.object({refs:z.array(KnowledgeReadInput).max(STANDARD_SUBTASK_LIMITS.maxRefs)}).strict();
export function parseSubtaskContextRefs(raw:readonly string[]=[]):z.infer<typeof KnowledgeReadInput>[] {
 const seen=new Set<string>();return raw.map(value=>{
  const parsed=KnowledgeReadInput.parse(JSON.parse(value));
  const reference={sourceId:parsed.sourceId,versionId:parsed.versionId,...(parsed.projectId?{projectId:parsed.projectId}:{})};
  const canonical=JSON.stringify(reference);if(seen.has(canonical))throw new Error('subtask_context_duplicate');seen.add(canonical);return reference;
 });
}
