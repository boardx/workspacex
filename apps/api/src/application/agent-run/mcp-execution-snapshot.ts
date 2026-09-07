import type {z} from 'zod';
import type {OrgId} from '../../domain/org-id';
import type {McpRunSnapshotView,McpInvokeInput,McpInvokeOutput,McpReviewInput} from '@repo/contracts/mcp-execution-snapshot';
import type {ExecutionAuthorityContext} from './tool-execution-authority';
export const MCP_EXECUTION_SNAPSHOT=Symbol('McpExecutionSnapshot');
export interface McpExecutionSnapshot {
 capture(context:ExecutionAuthorityContext):Promise<z.infer<typeof McpRunSnapshotView>>;
 resolve(context:ExecutionAuthorityContext):Promise<z.infer<typeof McpRunSnapshotView>>;
 invoke(runId:string,input:z.infer<typeof McpInvokeInput>):Promise<z.infer<typeof McpInvokeOutput>>;
 review(orgId:OrgId,reviewerId:string,input:z.infer<typeof McpReviewInput>):Promise<unknown>;
}
