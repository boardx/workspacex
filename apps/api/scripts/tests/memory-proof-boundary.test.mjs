import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkMemoryProof} from '../lib/memory-proof-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/agent-run/pg-standard-memory-proof.ts',import.meta.url),'utf8');
test('real memory facts/visibility boundary',()=>assert.deepEqual(checkMemoryProof(source),[]));
for(const [before,after] of [
 ['this.authority.check','this.authority.skip'],['!decision.allowed','false'],
 ['[orgId,runId]','["other",runId]'],['r.org_id=$1 AND r.id=$2','r.org_id=$1'],
 ['m.author_kind FROM','m.body FROM'],['run.author_id!==input.userId','false'],
 ['write.sourceMessageId!==run.input_message_id','false'],['await getThread(','await fakeRead('],
 ['userId:run.author_id,threadId','userId:input.userId,threadId'],
 ['return MemoryProofOutput.parse','return unsafeOutput'],
 ["currentVisibility.kind!=='allow'","false"],
])test('reject mutation '+before,()=>assert.ok(checkMemoryProof(source.replace(before,after)).length));
