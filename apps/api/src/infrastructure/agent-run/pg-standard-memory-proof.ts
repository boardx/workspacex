import { MemoryProofInput, MemoryProofOutput, MemorySearchInput, MemoryWriteInput, MemoryDeleteInput } from '@repo/contracts/standard-memory';
import type { z } from 'zod';
import type { DatabasePort } from '../../application/ports/database.port';
import type { StandardMemoryProof } from '../../application/agent-run/standard-memory-proof';
import type { ToolExecutionAuthority } from '../../application/agent-run/tool-execution-authority';
import { getThread, ThreadNotVisibleError, type GetThreadDeps } from '../../application/chat/get-thread';
import { withAuthorizedStandardToolRun } from './with-authorized-standard-tool-run';
import { toOrgId } from '../../domain/org-id';

/** A current-source proof, never a cached capability or a second visibility policy. */
export class PgStandardMemoryProof implements StandardMemoryProof {
  constructor(private db:DatabasePort,private authority:Pick<ToolExecutionAuthority,'check'>,private visibility:GetThreadDeps) {}
  async check(runId:string,raw:z.infer<typeof MemoryProofInput>) {
    const input=MemoryProofInput.parse(raw),orgId=toOrgId(input.orgId);
    const args={wx_memory_search:MemorySearchInput,wx_memory_write:MemoryWriteInput,wx_memory_delete:MemoryDeleteInput}[input.toolName].parse(input.toolArgs);
    return withAuthorizedStandardToolRun(this.db,this.authority,this.visibility,runId,{...input,toolArgs:args},async run=>{
      const visible:z.infer<typeof MemoryProofOutput>['visible']=[];
      const sources=[...input.sources];
      let sourceRef:z.infer<typeof MemoryProofOutput>['sourceRef'];
      if(input.toolName==='wx_memory_write') {
        const write=MemoryWriteInput.parse(args);
        if(write.sourceMessageId!==run.inputMessageId)throw new Error('memory_source_denied');
        sourceRef={threadId:run.threadId,messageId:run.inputMessageId};sources.push(sourceRef);
      }
      for(const source of sources) {
        const facts=await this.visibility.chat.findThreadFacts(orgId,source.threadId);
        if(!facts)continue;
        try {
          const thread=await getThread(this.visibility,{orgId,userId:run.userId,threadId:source.threadId,projectId:facts.projectId});
          if(thread.messages.some(message=>message.id===source.messageId)&&!visible.some(ref=>ref.threadId===source.threadId&&ref.messageId===source.messageId))visible.push(source);
        }catch(error){if(!(error instanceof ThreadNotVisibleError))throw error;}
      }
      if(sourceRef&&!visible.some(ref=>ref.threadId===sourceRef.threadId&&ref.messageId===sourceRef.messageId))throw new Error('memory_source_denied');
      return MemoryProofOutput.parse({scope:{orgId:input.orgId,userId:run.userId},visible,...(sourceRef?{sourceRef}:{})});
    });
  }
}
