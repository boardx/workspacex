import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStandardToolRun} from '../lib/standard-tool-run-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/agent-run/with-authorized-standard-tool-run.ts',import.meta.url),'utf8');
test('real shared trusted run boundary',()=>assert.deepEqual(checkStandardToolRun(source),[]));
for(const [before,after] of [
 ['authority.check','authority.skip'],['!decision.allowed','false'],
 ['[orgId,runId]','["other",runId]'],['r.org_id=$1 AND r.id=$2','r.org_id=$1'],
 ['m.author_kind FROM','m.body FROM'],['run.author_id!==input.userId','false'],
 ['await resolveVisibility(','await fakeVisibility('],["currentVisibility.kind!=='allow'",'false'],
 ['parentRunId:runId','parentRunId:"other"'],['return consume(','return rawOutput('],
 ['db.withTenant(orgId','db.withTenant(toOrgId("other")'],
])test('reject mutation '+before,()=>assert.ok(checkStandardToolRun(source.replace(before,after)).length));
