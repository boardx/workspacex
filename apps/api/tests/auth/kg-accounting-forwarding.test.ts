import {afterEach,it,expect,vi} from 'vitest';
import {PgKnowledgeRecall} from '../../src/infrastructure/knowledge-graph/pg-knowledge-recall';
import {LangChainEmbeddingClient} from '../../src/infrastructure/retrieval/langchain-embedding-client';
import {turnKnowledgeContext} from '../../src/application/knowledge-graph/recall-knowledge';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('org-kg'),ref={orgId:String(org),runId:'root',attemptId:'root:7',leaseEpoch:3};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function fixture(enabled=true){
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED',enabled?'1':'0');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','0');
 const fetch=vi.fn(async()=>new Response(JSON.stringify({model:'physical',modelVersion:'v',vectors:[[1,0]]}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 const db={withTenant:vi.fn(async()=>{throw new Error('unexpected DB');})};
 const pg=new PgKnowledgeRecall(db as never,new LangChainEmbeddingClient({baseUrl:'http://service.example.test',internalKey:'private',model:'physical',modelVersion:'v'}),enabled);
 return{fetch,db,pg};
}
it('server turn identity reaches KG embedding through the application port and existing private client',async()=>{
 const f=fixture(),knowledge={candidates:async()=>({claims:[],objects:[]}),graphNeighbors:async()=>[],recordTurn:async()=>{},vectorNeighbors:f.pg.vectorNeighbors.bind(f.pg)};
 await turnKnowledgeContext(knowledge,undefined,{orgId:org,accounting:ref,run:{requesterUserId:'actual',threadId:'thread',inputText:'transient-query',runId:'root',inputMessageId:'input'}},()=>{});
 expect(f.fetch).toHaveBeenCalledOnce();const body=JSON.parse((f.fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(body.accounting).toEqual(ref);expect(Object.keys(body.accounting).sort()).toEqual(['attemptId','leaseEpoch','orgId','runId']);expect(f.db.withTenant).not.toHaveBeenCalled();
});
it('foreign, missing, stale-format and forged actor contexts send no service HTTP',async()=>{
 const f=fixture();for(const bad of [undefined,{...ref,orgId:'other'},{...ref,leaseEpoch:0},{...ref,userId:'forged'}])await expect(f.pg.vectorNeighbors(org,'actual','query',Promise.resolve([]),1,bad as never)).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
});
it('default-off preserves existing unaccounted protocol rather than claim coverage',async()=>{
 const f=fixture(false);await f.pg.vectorNeighbors(org,'actual','query',Promise.resolve([]),1,ref);const body=JSON.parse((f.fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(body.accounting).toBeUndefined();
});
