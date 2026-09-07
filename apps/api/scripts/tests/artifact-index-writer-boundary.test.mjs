import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{checkArtifactIndexWriter}from'../lib/artifact-index-writer-boundary.mjs';
const source=readFileSync(new URL('../../src/infrastructure/retrieval/pg-artifact-index-writer.ts',import.meta.url),'utf8');
test('index writer has same-transaction source reauthorization and bounded writes',()=>assert.deepEqual(checkArtifactIndexWriter(source),[]));
for(const[before,after]of[['this.source.load(input)','this.source.skip(input)'],['JSON.stringify(current)!==JSON.stringify(batch)','false'],['withTenant(input.orgId','withTenant(otherOrg'],['RETURNING segment_id','RETURNING content'],['v.org_id=$1 AND',''],['[segment.segmentId,input.orgId','[segment.segmentId,otherOrg'],['const current=await this.source.load(input);','const current=await this.source.load(input);return current;']])test('reject '+before,()=>assert.ok(checkArtifactIndexWriter(source.replace(before,after)).length));
