import type { DatabasePort } from '../../application/ports/database.port';
import type { ToolExecutionAuthority,ToolExecutionCheck } from '../../application/agent-run/tool-execution-authority';
import type { GetThreadDeps } from '../../application/chat/get-thread';
import { resolveVisibility } from '../../application/chat/resolve-visibility';
import { toOrgId,type OrgId } from '../../domain/org-id';
export type StandardToolContext=Omit<ToolExecutionCheck,'orgId'|'parentRunId'> & {orgId:string;userId:string};
export type AuthorizedStandardToolRun={orgId:OrgId;userId:string;threadId:string;inputMessageId:string};

/** Shared current facts authorization for memory and deployment SQL sources.
 * The callback is not a reusable grant or a promise that later remote work cannot be cancelled. */
export async function withAuthorizedStandardToolRun<T>(db:DatabasePort,authority:Pick<ToolExecutionAuthority,'check'>,
 visibility:GetThreadDeps,runId:string,input:StandardToolContext,consume:(run:AuthorizedStandardToolRun)=>Promise<T>):Promise<T>{
 const orgId=toOrgId(input.orgId);
 return db.withTenant(orgId,async session=>{
  const decision=await authority.check({...input,orgId,parentRunId:runId});
  if(!decision.allowed)throw new Error('standard_tool_authority_denied');
  const run=(await session.query<{thread_id:string;input_message_id:string;author_id:string;author_kind:string}>(
   `SELECT r.thread_id,r.input_message_id,m.author_id,m.author_kind FROM agent_runs r
    JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
    WHERE r.org_id=$1 AND r.id=$2`,[orgId,runId])).rows[0];
  if(!run||run.author_kind!=='human'||run.author_id!==input.userId)throw new Error('standard_tool_scope_denied');
  const currentThread=await visibility.chat.findThreadFacts(orgId,run.thread_id);
  if(!currentThread)throw new Error('standard_tool_scope_denied');
  const currentVisibility=await resolveVisibility(visibility,{orgId,userId:run.author_id,threadId:run.thread_id,projectId:currentThread.projectId});
  if(currentVisibility.kind!=='allow')throw new Error('standard_tool_scope_denied');
  return consume({orgId,userId:run.author_id,threadId:run.thread_id,inputMessageId:run.input_message_id});
 });
}
