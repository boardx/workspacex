import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkMemoryProof} from '../lib/memory-proof-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/agent-run/pg-standard-memory-proof.ts',import.meta.url),'utf8');
test('real memory facts/visibility boundary',()=>assert.deepEqual(checkMemoryProof(source),[]));
for(const [before,after] of [
 ['withAuthorizedStandardToolRun(this.db','bypassAuthorization(this.db'],
 ['runId,{...input,toolArgs:args}','"other",{...input,toolArgs:args}'],
 ['write.sourceMessageId!==run.inputMessageId','false'],['await getThread(','await fakeRead('],
 ['userId:run.userId,threadId','userId:input.userId,threadId'],
 ['return MemoryProofOutput.parse','return unsafeOutput'],
])test('reject mutation '+before,()=>assert.ok(checkMemoryProof(source.replace(before,after)).length));
