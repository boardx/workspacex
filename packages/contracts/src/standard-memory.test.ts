import { expect,it } from 'vitest';
import { MemoryProofInput,MemoryWriteInput,MemorySearchOutput } from './standard-memory';
it('keeps caller identity outside model args and literal output explicit',()=>{
 expect(MemoryWriteInput.safeParse({text:'a',sourceMessageId:'m',idempotencyKey:'key',userId:'other'}).success).toBe(false);
 expect(MemorySearchOutput.safeParse({items:[]}).success).toBe(false);
 expect(MemoryProofInput.safeParse({orgId:'o',userId:'u',attemptId:'a',leaseEpoch:1,toolCallId:'c',toolName:'wx_memory_search',toolArgs:{},sources:[]}).success).toBe(true);
});
