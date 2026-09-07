import {z} from 'zod';
import {McpTool,ToolWhitelistEntry,operations} from './agent-runtime';
import {NativeSessionResolveInput} from './native-session-binding';
export {MCP_EXECUTION_LIMITS,McpRuntimeTool,McpRunSnapshotRef,McpRunSnapshotView} from './mcp-runtime-snapshot';
import {McpRuntimeTool} from './mcp-runtime-snapshot';
/** Infrastructure-only frozen authorization evidence; endpoint never appears in runtime view. */
export const McpFrozenTool=z.object({reviewId:z.string().uuid(),credentialRevision:z.string().uuid().nullable().optional(),endpoint:z.string(),tool:McpTool,whitelistEntry:ToolWhitelistEntry,runtime:McpRuntimeTool}).strict();
export const McpInvokeInput=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),toolName:McpRuntimeTool.shape.name,toolArgs:z.record(z.unknown()),permissionRequestId:z.string().uuid().optional()}).strict();
export const McpInvokeOutput=z.object({content:z.array(z.unknown()),structuredContent:z.record(z.unknown()).optional(),isError:z.boolean().optional()}).strict();
export const McpReviewInput=operations.reviewMcpServer.in;

export const McpIsolationInput=operations.reIsolateMcpServer.in;
export const McpIsolationOutput=operations.reIsolateMcpServer.out;
