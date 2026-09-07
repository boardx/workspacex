import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OrganizationHybridRetrieval} from '../../src/infrastructure/retrieval/organization-hybrid-retrieval';
test('missing trusted embedding/reranker rejects hybrid rather than silent FTS',async()=>{
 const hybrid=new OrganizationHybridRetrieval(undefined as never,undefined as never,undefined as never);
 await assert.rejects(()=>hybrid.search({orgId:'o' as never,userId:'u',threadId:'t',projectId:null},{query:'evidence'}),/hybrid_not_configured/);
});
