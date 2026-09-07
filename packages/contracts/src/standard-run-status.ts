import {z} from 'zod';
import {NativeSessionResolveInput} from './native-session-binding';
import {AgentRunStep,AgentRunStatus} from './wave2-runtime';

export const STANDARD_RUN_STATUS_TOOL='wx_run_status' as const;
export const RunStatusInput=z.object({runId:z.string().min(1).max(256)}).strict();
export const RunArtifactRef=z.object({artifactId:z.string(),versionId:z.string()}).strict();
export type RunArtifactRef=z.infer<typeof RunArtifactRef>;
export const RunStatusOutput=z.object({
 status:AgentRunStatus,steps:z.array(AgentRunStep),
 waitingRequest:z.object({permissionRequestId:z.string().uuid().nullable().optional(),toolName:z.string(),argsSummary:z.string().nullable()}).strict().nullable(),
 artifactRefs:z.array(RunArtifactRef),observedAt:z.string().datetime(),
}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const StandardRunStatusInvocation=identity.extend({toolName:z.literal(STANDARD_RUN_STATUS_TOOL),toolArgs:RunStatusInput}).strict();
