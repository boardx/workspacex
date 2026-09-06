import { MemoryProofInput, MemoryProofOutput, MemorySearchInput, MemoryWriteInput, MemoryDeleteInput } from '@repo/contracts/standard-memory';
import type { z } from 'zod';
import type { DatabasePort } from '../../application/ports/database.port';
import type { StandardMemoryProof } from '../../application/agent-run/standard-memory-proof';
import type { ToolExecutionAuthority } from '../../application/agent-run/tool-execution-authority';
import { getThread, ThreadNotVisibleError, type GetThreadDeps } from '../../application/chat/get-thread';
import { resolveVisibility } from '../../application/chat/resolve-visibility';
import { toOrgId } from '../../domain/org-id';

/** A current-source proof, never a cached capability or a second visibility policy. */
export class PgStandardMemoryProof implements StandardMemoryProof {
  constructor(private db:DatabasePort,private authority:Pick<ToolExecutionAuthority,'check'>,private visibility:GetThreadDeps) {}
  async check(runId:string,raw:z.infer<typeof MemoryProofInput>) {
    const input=MemoryProofInput.parse(raw),orgId=toOrgId(input.orgId);
    const args={wx_memory_search:MemorySearchInput,wx_memory_write:MemoryWriteInput,wx_memory_delete:MemoryDeleteInput}[input.toolName].parse(input.toolArgs);
    return this.db.withTenant(orgId,async session=>{
      const decision=await this.authority.check({orgId,parentRunId:runId,attemptId:input.attemptId,leaseEpoch:input.leaseEpoch,
        toolName:input.toolName,toolCallId:input.toolCallId,toolArgs:args,permissionRequestId:input.permissionRequestId});
      if(!decision.allowed)throw new Error('memory_authority_denied');
      const run=(await session.query<{thread_id:string;input_message_id:string;author_id:string;author_kind:string}>(
        `SELECT r.thread_id,r.input_message_id,m.author_id,m.author_kind FROM agent_runs r
         JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
         WHERE r.org_id=$1 AND r.id=$2`,[orgId,runId])).rows[0];
      if(!run||run.author_kind!=='human'||run.author_id!==input.userId)throw new Error('memory_scope_denied');
      const currentThread=await this.visibility.chat.findThreadFacts(orgId,run.thread_id);
      if(!currentThread)throw new Error('memory_scope_denied');
      const currentVisibility=await resolveVisibility(this.visibility,{orgId,userId:run.author_id,threadId:run.thread_id,projectId:currentThread.projectId});
      if(currentVisibility.kind!=='allow')throw new Error('memory_scope_denied');
      const visible:z.infer<typeof MemoryProofOutput>['visible']=[];
      const sources=[...input.sources];
      let sourceRef:z.infer<typeof MemoryProofOutput>['sourceRef'];
      if(input.toolName==='wx_memory_write') {
        const write=MemoryWriteInput.parse(args);
        if(write.sourceMessageId!==run.input_message_id)throw new Error('memory_source_denied');
        sourceRef={threadId:run.thread_id,messageId:run.input_message_id};sources.push(sourceRef);
      }
      for(const source of sources) {
        const facts=await this.visibility.chat.findThreadFacts(orgId,source.threadId);
        if(!facts)continue;
        try {
          const thread=await getThread(this.visibility,{orgId,userId:run.author_id,threadId:source.threadId,projectId:facts.projectId});
          if(thread.messages.some(message=>message.id===source.messageId)&&!visible.some(ref=>ref.threadId===source.threadId&&ref.messageId===source.messageId))visible.push(source);
        }catch(error){if(!(error instanceof ThreadNotVisibleError))throw error;}
      }
      if(sourceRef&&!visible.some(ref=>ref.threadId===sourceRef.threadId&&ref.messageId===sourceRef.messageId))throw new Error('memory_source_denied');
      return MemoryProofOutput.parse({scope:{orgId:input.orgId,userId:run.author_id},visible,...(sourceRef?{sourceRef}:{})});
    });
  }
}
