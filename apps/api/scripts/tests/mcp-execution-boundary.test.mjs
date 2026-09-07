import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MCP_EXECUTION_BOUNDARIES,checkMcpExecutionBoundary} from '../lib/mcp-execution-boundary.mjs';
for(const path of MCP_EXECUTION_BOUNDARIES){
 const source=readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 test(path+' real boundary',()=>assert.deepEqual(checkMcpExecutionBoundary(path,source),[]));
 const mutations=path.includes('review-snapshots')?[
  ['!member||', 'false&&'],['this.identity.findOrgMembership','this.identity.fakeMembership'],['reviewMcpServer({','fakeReview({'],['reviewerId,verdict:input.verdict','reviewerId:"other",verdict:input.verdict'],['WHERE org_id=$1 AND server_id=$2 FOR UPDATE','WHERE server_id=$2'],['[orgId,input.serverId','["other",input.serverId']
 ]:[
  ['await this.recheck(context,frozen);','void frozen;'],['!state?.active||state.cancelRequested','!state?.active||false'],['!state.leaseValid','false'],['this.authority.check(context)','this.authority.fake(context)'],['await resolveVisibility(','await fakeVisibility('],["m.thread_id=r.thread_id AND m.author_kind='human'",'m.thread_id=r.thread_id'],['v.agent_id=r.agent_id','v.agent_id=v.agent_id'],['record.authScopeSet!==server.auth_scope','false'],['tool.authScope!==record.authScopeSet||!whitelistEntryGrants(entry)','false'],['frozen.reviewId!==current.reviewId','false'],['server.credential_configured||server.involves_customer_data','false'],["prior.status!=='succeeded'",'false'],['private async facts','async facts'],['[org,run]','["foreign",run]']
 ];
 for(const [before,after] of mutations)test(path+' rejects '+before,()=>{assert.ok(source.includes(before));assert.ok(checkMcpExecutionBoundary(path,source.replace(before,after)).length);});
}
