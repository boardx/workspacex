import type {StandardEntryScope} from '../../application/agent-run/standard-entry-scope';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import type {AgentRunStore} from '../../application/agent-run/ports';
import type {GetThreadDeps} from '../../application/chat/get-thread';
import {withAuthorizedStandardToolRun} from './with-authorized-standard-tool-run';
import {toOrgId} from '../../domain/org-id';
export class AuthorizedNativeEntryScope implements StandardEntryScope {
 constructor(private readonly db:DatabasePort,private readonly authority:ToolExecutionAuthority,private readonly visibility:GetThreadDeps,private readonly runs:AgentRunStore){}
 async run<T>(runId:string,input:Parameters<StandardEntryScope['run']>[1],consume:(actor:{orgId:ReturnType<typeof toOrgId>;userId:string})=>Promise<T>){
  const userId=await this.runs.findRequesterUserId?.(toOrgId(input.orgId),runId);
  if(!userId)throw new Error('standard_entry_scope_denied');
  return withAuthorizedStandardToolRun(this.db,this.authority,this.visibility,runId,{...input,userId},consume);
 }
}
