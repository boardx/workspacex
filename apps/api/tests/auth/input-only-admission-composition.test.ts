import {createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {RuntimeModelRequestAdmission} from '@repo/contracts/runtime-model-usage';
import {ArtifactEmbeddingRequestAdmission} from '@repo/contracts/artifact-embedding-accounting';
import {PgRuntimeModelUsageRepository} from '../../src/infrastructure/auth/pg-runtime-model-usage-repository';
import {VerifiedInputOnlyBoundRegistry} from '../../src/application/agent-run/verified-input-only-bound-registry';
import {inputOnlyReceiptCost} from '../../src/application/agent-run/admit-priced-input-only-call';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('input-only-org'),requestId='ab05ca76-9ff5-459b-955f-73634b36ec23';
const config={window:{start:'2026-10-01T00:00:00Z',end:'2026-11-01T00:00:00Z',timezone:'Etc/UTC'},ordinaryTokensPerUser:'100',costMicrosPerUser:'100',currency:'CNY',prices:[{billingMode:'input-only' as const,modelId:'formal',modelProvider:'route',runtimeModelId:'actual',inputMicrosPerMillion:'1000000',cachedInputMicrosPerMillion:'1000000',maxInputTokens:10}],fallbackModelIds:[],maxAttempts:1};
afterEach(()=>vi.unstubAllEnvs());
function fixture(child=false,verified=true,confidentiality:'unknown'|'non-confidential'='non-confidential',tokenLimit='100',costLimit='100'){
 const owner={user_id:'original-author',project_id:'project',thread_id:'thread',agent_id:'agent',root_run_id:'root',subtask_id:child?'child':null};
 const query=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.includes('FROM agent_runs'))return {rows:child?[]:[owner]};
  if(sql.includes('FROM subtask_runs'))return {rows:child?[owner]:[]};
  if(sql.includes('FROM organizations'))return {rows:[{id:org}]};
  if(sql.includes('FROM org_memberships'))return {rows:[{member:1}]};
  if(sql.includes('FROM organization_plans'))return {rows:[{plan:'ordinary'}]};
  if(sql.includes('FROM organization_ai_policies'))return {rows:[{configuration:config,price_version:'audited',updated_by:'operator'}]};
  if(sql.includes(' AS active'))return {rows:[{active:true}]};
  if(sql.includes('SELECT token_limit'))return {rows:[{token_limit:tokenLimit,cost_limit_micros:costLimit,currency:'CNY',price_version:'audited'}]};
  if(sql.includes('FROM effective_token_usage()'))return {rows:[{tokens:'0',cost:'0',unknown_tokens:'0',unknown_cost:'0'}]};
  if(sql.includes('COALESCE(sum(GREATEST(r.maximum_tokens'))return {rows:[{tokens:'0',cost:'0'}]};
  if(sql.includes('INSERT INTO model_request_starts'))return {rows:[{id:args[0]}]};
  return {rows:[]};
 });
 const withTenant=vi.fn(async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});});
 const registry=new VerifiedInputOnlyBoundRegistry([{binding:{billingMode:'input-only',modelId:'formal',modelProvider:'route',runtimeModelId:'actual',contextWindow:100,capabilityTags:['embedding'],noBilledOutputVerified:true,accountingComplete:true},requestPath:'/v1/embeddings',implementation:'fixture-proof',version:'1',artifactSha256:'a'.repeat(64),source:'verified-upper-bound',verifyDeploymentBinding:async()=>verified,measureSerializedBody:async()=>2}]);
 const pool={listForOrg:vi.fn().mockResolvedValue([{row:{modelId:'formal',kind:'closed-api',shape:'single',status:'已启用',complianceAttrs:[],members:[],contextWindow:100,capabilityTags:['embedding']}}])};
 const repo=new PgRuntimeModelUsageRepository({withTenant} as never,{record:vi.fn()} as never,undefined,{dependencies:vi.fn(),primaryModelId:vi.fn(),facts:async()=>({confidentiality,requiredCapabilities:['embedding']}),inputOnly:{provider:'route',primaryModelId:id=>registry.formalModelId('route',id),dependencies:()=>({currentCandidates:()=>registry.currentCandidates(pool as never,String(org)),measure:request=>registry.measure(request)})}});
 const body=JSON.stringify({model:'actual',input:[[23,45],[67]],encoding_format:'base64'}),runId=child?'child':'root';
 const input={billingMode:'input-only' as const,requestId,attemptId:runId+':1',leaseEpoch:1,startedAt:'2026-10-04T03:00:00Z',modelId:'actual',callPurpose:'retrieval-embedding' as const,serializedBody:body,requestPath:'/v1/embeddings',logicalCallId:JSON.stringify([runId,'retrieval-embedding',requestId,createHash('sha256').update(body).digest('hex'),'/v1/embeddings'])};
 return {repo,input,query,withTenant,runId};
}
for(const child of [false,true])it(`input-only ${child?'child':'root'} reserves measured input before durable start in one tenant transaction`,async()=>{
 const f=fixture(child);await f.repo.admitRuntimeRequest(org,f.runId,f.input);expect(f.withTenant).toHaveBeenCalledOnce();
 const reserve=f.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO ai_request_reservations'))!,start=f.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO model_request_starts'))!;
 expect(f.query.mock.calls.indexOf(reserve)).toBeLessThan(f.query.mock.calls.indexOf(start));expect(reserve[1][5]).toBe('2');expect(reserve[1][6]).toBe('2');
 expect(start[1][2]).toBe('original-author');expect(start[1][3]).toBe('root');expect(start[1][13]).toBe(child?'child':null);
 expect(JSON.stringify(f.query.mock.calls.map(c=>c[1]))).not.toContain('encoding_format');
});
it('unverified binding, unknown classification, token exhaustion and cost exhaustion cannot create a start',async()=>{
 for(const f of [fixture(false,false),fixture(false,true,'unknown'),fixture(false,true,'non-confidential','1'),fixture(false,true,'non-confidential','100','1')]){
  await expect(f.repo.admitRuntimeRequest(org,f.runId,f.input)).rejects.toThrow();expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO model_request_starts'))).toBe(false);
 }
});
it('strict private input-only contracts reject output caps and actor claims',()=>{
 const f=fixture();expect(RuntimeModelRequestAdmission.safeParse({...f.input,orgId:org}).success).toBe(true);
 expect(RuntimeModelRequestAdmission.safeParse({...f.input,orgId:org,outputTokenLimit:0}).success).toBe(false);
 expect(RuntimeModelRequestAdmission.safeParse({...f.input,orgId:org,userId:'forged'}).success).toBe(false);
 const {attemptId:_attempt,leaseEpoch:_epoch,callPurpose:_purpose,...artifact}=f.input;
 expect(ArtifactEmbeddingRequestAdmission.safeParse({...artifact,orgId:org}).success).toBe(true);
 expect(ArtifactEmbeddingRequestAdmission.safeParse({...artifact,orgId:org,runId:'fake'}).success).toBe(false);
});
it('input-only settlement uses reported input/total, retains missing completion and unknown cache/output holds',()=>{
 const price={version:'immutable',currency:'CNY',inputMicrosPerMillion:1000000n,cachedInputMicrosPerMillion:1000000n};
 expect(inputOnlyReceiptCost(price,{prompt:4,total:4})).toBe(4n);
 for(const usage of [{},{prompt:4},{prompt:4,total:5},{prompt:4,total:4,completion:1},{prompt:4,total:4,cacheInput:5},{prompt:4,total:4,reasoningOutput:1}])expect(inputOnlyReceiptCost(price,usage)).toBeNull();
 expect(inputOnlyReceiptCost({...price,cachedInputMicrosPerMillion:2000000n},{prompt:4,total:4})).toBeNull();
 expect(inputOnlyReceiptCost({...price,cachedInputMicrosPerMillion:2000000n},{prompt:4,total:4,cacheInput:1})).toBe(5n);
});
