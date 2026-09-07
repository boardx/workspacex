import type { z } from 'zod';
import type { MemoryProofInput, MemoryProofOutput } from '@repo/contracts/standard-memory';
export const STANDARD_MEMORY_PROOF = Symbol('StandardMemoryProof');
export interface StandardMemoryProof {
  check(runId:string,input:z.infer<typeof MemoryProofInput>):Promise<z.infer<typeof MemoryProofOutput>>;
}
