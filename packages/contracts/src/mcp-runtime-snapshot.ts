import {z} from 'zod';
export const MCP_EXECUTION_LIMITS={maxCredentialBytes:8192,cancelPollMs:200,cancelAckGraceMs:2000,maxConcurrentExecutions:2,workerHeapMb:128,maxTools:64,maxInvocations:128,maxNameLength:64,maxArgsBytes:262144,maxResultBytes:1048576,deadlineMs:30000} as const;
export const McpRuntimeTool=z.object({name:z.string().regex(/^mcp__[a-z0-9-]+__[a-z0-9_]+$/).max(MCP_EXECUTION_LIMITS.maxNameLength),canonicalName:z.string(),description:z.string().max(16000),inputSchema:z.record(z.unknown()),outputSchema:z.record(z.unknown()).optional(),schemaFingerprint:z.string().regex(/^v2:[a-f0-9]{64}$/)}).strict();
export const McpRunSnapshotRef=z.object({snapshotId:z.string().uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const McpRunSnapshotView=z.object({ref:McpRunSnapshotRef,tools:z.array(McpRuntimeTool).max(MCP_EXECUTION_LIMITS.maxTools)}).strict();
