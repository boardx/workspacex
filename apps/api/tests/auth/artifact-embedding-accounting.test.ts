import {afterEach,it,expect,vi} from 'vitest';
import {resolveArtifactRequestStart} from '../../src/infrastructure/auth/pg-runtime-model-usage-repository';
import {PgArtifactEmbeddingAccounting} from '../../src/infrastructure/retrieval/pg-artifact-embedding-accounting';
import {ArtifactEmbeddingOwnershipDenied} from '../../src/application/retrieval/artifact-embedding-accounting';
import {IndexArtifactVersion} from '../../src/application/retrieval/index-artifact-version';
import {LangChainEmbeddingClient} from '../../src/infrastructure/retrieval/langchain-embedding-client';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('artifact-org'),stamp=new Date('2026-10-04T03:00:00Z'),hash='a'.repeat(64);
const batch={publisherUserId:'publisher',artifactVersionId:'v1',artifactId:'a1',projectId:null,externalEmbeddingAllowed:true,requiresReview:false,contentHash:hash,segments:[{segmentId:'s1',content:'one'},{segmentId:'s2',content:'two'}]};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function fixture(){
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED','1');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','0');vi.stubEnv('KERNEL_MODEL_PROVIDER','actual-provider');vi.stubEnv('KERNEL_EMBEDDING_MODEL_ID','actual-model');
 const ops=new Map<string,Record<string,unknown>>(),starts=new Map<string,Record<string,unknown>>();let active=true,member=true,connections=0;
 const query=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.includes('FROM org_memberships'))return {rows:member?[{org_role:'admin',team_id:null}]:[]};
  if(sql.includes('FROM acl_bindings'))return {rows:[]};
  if(sql.includes('JOIN artifacts'))return {rows:[{artifact_id:'a1',project_id:null,ingestion_status:active?'INDEXED':'READY',confidential:false}]};
  if(sql.includes('FROM artifact_versions'))return {rows:[{id:'v1',artifact_id:'a1',version_number:1,object_storage_key:'private-source',content_hash:hash,mime:'text/plain',size_bytes:'3',pinned_by:'publisher',pinned_at:stamp,context_pack_id:null}]};
  if(sql.includes('FROM ingestion_outbox')){expect(sql).toContain('FOR SHARE');return {rows:active?[{id:'job'}]:[]};}
  if(sql.includes('INSERT INTO artifact_embedding_operations')){ops.set(String(args[0]),{id:args[0],org_id:args[1],user_id:args[2],artifact_id:args[3],artifact_version_id:args[4],project_id:args[5],content_hash:args[6],ingestion_job_id:args[7],ingestion_attempt:args[8]});return {rows:[]};}
  if(sql.includes('FROM artifact_embedding_operations'))return {rows:ops.get(String(args[1]))?.org_id===args[0]?[ops.get(String(args[1]))]:[]};
  if(sql.includes('FROM model_request_starts'))return {rows:starts.get(String(args[1]))?.org_id===args[0]?[starts.get(String(args[1]))]:[]};
  if(sql.includes('INTO model_request_starts')){expect(sql).toMatch(/ON CONFLICT\s*\(id\) DO NOTHING/);if(!starts.has(String(args[0])))starts.set(String(args[0]),{org_id:args[1],user_id:args[2],project_id:args[5],artifact_operation_id:args[14],model_provider:args[6],model_id:args[7],started_at:new Date(String(args[8]))});return {rows:[]};}
  return {rows:[]};
 });
 const locks=new Map<string,Promise<void>>();
 const db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>{
  connections++;const releases:Array<()=>void>=[];
  const transactionQuery=async(sql:string,args:unknown[])=>{
   if(sql.includes('pg_advisory_xact_lock')){
    const key=String(args[0]),previous=locks.get(key)??Promise.resolve();
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    locks.set(key,previous.then(()=>held));await previous;releases.push(release);
   }
   return query(sql,args);
  };
  try{return await work({query:transactionQuery});}finally{for(const release of releases)release();}
 }};
 const accounting=new PgArtifactEmbeddingAccounting(db as never),input={orgId:org,artifactVersionId:'v1',ingestionClaim:{jobId:'job',attempt:2}},start={requestId:'84f45cd6-e5b7-432b-b8d6-70a377f01ddd',modelId:'actual-model',startedAt:stamp.toISOString()};
 return {accounting,input,start,query,ops,starts,get connections(){return connections;},setActive:(v:boolean)=>active=v,setMember:(v:boolean)=>member=v};
}
it('durable opaque operation reaches every segment service HTTP without actor/run claims',async()=>{
 const f=fixture(),fetch=vi.fn(async(_url:string,init:RequestInit)=>{expect(f.ops.size).toBe(1);return new Response(JSON.stringify({model:'actual-model',modelVersion:'v',vectors:[[1,0]]}),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',fetch);
 const write=vi.fn(async()=>{}),embed=new LangChainEmbeddingClient({baseUrl:'http://service.example.test',internalKey:'private-key',model:'actual-model',modelVersion:'v'});
 await new IndexArtifactVersion({load:async()=>batch},{write},embed,f.accounting).index({...f.input,requestedBy:'authorized-reindexer'});
 expect(fetch).toHaveBeenCalledTimes(2);expect(write).toHaveBeenCalledOnce();for(const [,init] of fetch.mock.calls){const ref=JSON.parse(init.body as string).accounting;expect(ref).toEqual({kind:'artifact-index',orgId:org,operationId:[...f.ops.keys()][0]});expect(Object.keys(ref).sort()).toEqual(['kind','operationId','orgId']);}
 expect([...f.ops.values()][0]?.user_id).toBe('authorized-reindexer');
});
it('automatic job derives publisher; start uses one scoped connection and leaves Agent identity null',async()=>{
 const f=fixture(),ref=await f.accounting.open(f.input,batch),before=f.connections;await f.accounting.start(org,ref.operationId,f.start);expect(f.connections-before).toBe(1);
 const insert=f.query.mock.calls.find(c=>c[0].includes('INTO model_request_starts'))!;expect(insert[1][2]).toBe('publisher');expect(insert[1][3]).toBeNull();expect(insert[1][4]).toBeNull();expect(insert[1][12]).toBeNull();expect(insert[1][14]).toBe(ref.operationId);
});
it('stale claim, foreign operation and current revoked membership cannot mint a start',async()=>{
 const f=fixture(),ref=await f.accounting.open(f.input,batch);f.setActive(false);
 await expect(f.accounting.start(org,ref.operationId,f.start)).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);
 await expect(f.accounting.start(toOrgId('foreign'),ref.operationId,f.start)).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);f.setActive(true);f.setMember(false);await expect(f.accounting.start(org,ref.operationId,f.start)).rejects.toThrow();expect(f.starts.size).toBe(0);
});
it('late receipt preserves durable original owner after job/membership change and rejects foreign receipt',async()=>{
 const f=fixture(),ref=await f.accounting.open(f.input,batch);await f.accounting.start(org,ref.operationId,f.start);f.setActive(false);f.setMember(false);
 await f.accounting.terminal(org,ref.operationId,{requestId:f.start.requestId,endedAt:new Date(stamp.getTime()+1).toISOString(),outcome:'failed',usage:{prompt:4,total:4}});
 const insert=f.query.mock.calls.find(c=>c[0].includes('INTO token_usage_events'))!;expect(insert[1][2]).toBe('publisher');expect(insert[1][3]).toBeNull();expect(insert[1].slice(6,11)).toEqual([4,4,null,'failed','reported']);
 await expect(f.accounting.terminal(toOrgId('foreign'),ref.operationId,{requestId:f.start.requestId,endedAt:stamp.toISOString(),outcome:'failed',usage:{}})).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);
});
it('input-only quota admission missing rejects start without accessing DB or fabricating chat cap',async()=>{
 const f=fixture();vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','1');await expect(f.accounting.start(org,'84f45cd6-e5b7-432b-b8d6-70a377f01ddd',f.start)).rejects.toThrow('ARTIFACT_EMBEDDING_ADMISSION_REQUIRED');expect(f.query).not.toHaveBeenCalled();
});

it('private resolver exposes six identity fields even if SQL adapter returns extra content',async()=>{
 const query=vi.fn(async()=>({rows:[{user_id:'owner',project_id:null,artifact_operation_id:'operation',model_provider:'p',model_id:'m',started_at:stamp,content:'must-not-return',api_key:'secret'}]}));
 const row=await resolveArtifactRequestStart({query} as never,org,'request');expect(Object.keys(row!).sort()).toEqual(['artifact_operation_id','model_id','model_provider','project_id','started_at','user_id']);expect(row).not.toHaveProperty('content');expect(row).not.toHaveProperty('api_key');
});
it('concurrent conflicting operation request IDs and cross-tenant collisions cannot both acknowledge',async()=>{
 const f=fixture(),first=await f.accounting.open(f.input,batch),other=await f.accounting.open({...f.input,requestedBy:'reindexer'},batch);
 const results=await Promise.allSettled([f.accounting.start(org,first.operationId,f.start),f.accounting.start(org,other.operationId,f.start)]);
 expect(results[0]?.status).toBe('fulfilled');expect(results[1]?.status).toBe('rejected');expect(f.starts.size).toBe(1);
 const stored={...f.starts.get(f.start.requestId)};
 expect(stored).toMatchObject({org_id:org,user_id:'publisher',artifact_operation_id:first.operationId});
 const foreign=toOrgId('foreign');
 const foreignOperation=await f.accounting.open({...f.input,orgId:foreign,requestedBy:'foreign-owner'},batch);
 expect(f.ops.get(foreignOperation.operationId)?.org_id).toBe(foreign);
 await expect(f.accounting.start(foreign,foreignOperation.operationId,f.start)).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);
 expect(f.query.mock.calls.some(([sql,args])=>sql.includes('INTO model_request_starts')&&args[1]===foreign)).toBe(true);
 expect(f.starts.get(f.start.requestId)).toEqual(stored);expect(f.starts.size).toBe(1);
});
