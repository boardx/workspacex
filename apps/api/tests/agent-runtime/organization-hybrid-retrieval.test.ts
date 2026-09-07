import {addChatThread,addChatMessage} from '../support/chat-db';
import {KnowledgeSearchOutput} from '@repo/contracts/standard-context-tools';
import {randomUUID,createHash} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,addProjectMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {indexSegment,addEmbedding,addClaim,registerEmbeddingModel,TableEmbedding} from '../support/retrieval-fixtures';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgOrganizationKnowledgeIndex} from '../../src/infrastructure/retrieval/pg-organization-knowledge-index';
import {PgSegmentRetriever} from '../../src/infrastructure/retrieval/pg-segment-retriever';
import {OrganizationHybridRetrieval} from '../../src/infrastructure/retrieval/organization-hybrid-retrieval';
import {LangChainRerankClient} from '../../src/infrastructure/retrieval/langchain-rerank-client';
import {OrganizationContextSource} from '../../src/infrastructure/agent-run/organization-context-source';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('hybrid-'+randomUUID()),foreign=toOrgId('foreign-'+randomUUID()),project='p-'+org,model='model-'+org;
const actor={orgId:org,userId:'alice',threadId:'trusted',projectId:null};
let db:PgDatabase,server:Server,source:OrganizationContextSource;
let seen:string[]=[];let mode:'normal'|'foreign-id'|'failure'|'revoke'='normal';
const query='workshop evidence';
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 await seedOrg({orgId:org,projectId:project});await seedOrg({orgId:foreign,projectId:'p-'+foreign});
 await addOrgMember(org,'alice','consultant',null);await addOrgMember(org,'bob','consultant',null);await addProjectMember(org,project,'alice','member',null);
 await registerEmbeddingModel(model,'1',2);
 for(const[id,opts]of Object.entries({public:{},member:{projectId:project,layer:'project' as const},pending:{lifecycle:'review-pending' as const},revoked:{lifecycle:'revoked' as const},private:{layer:'personal' as const,private:true},interview:{sourceType:'interview'}})){
  await indexSegment({orgId:org,segmentId:id+'-'+org,artifactId:'a-'+id+'-'+org,content:query+' '+id,layer:'org',sourceType:'file',...opts});
  if(id==='member')await asApp(org,c=>c.query('UPDATE artifacts SET project_id=$2 WHERE id=$1',['a-'+id+'-'+org,project]));
  await addEmbedding({orgId:org,segmentId:id+'-'+org,model,modelVersion:'1',vector:[1,0]});
 }
 await indexSegment({orgId:foreign,segmentId:'foreign-'+org,artifactId:'a-foreign-'+org,content:query+' SECRET',layer:'org',sourceType:'file'});
 await addClaim({orgId:org,id:'claim-'+org,statement:query+' hidden statement',status:'contested',supporting:['public-'+org],contradicting:['member-'+org]});
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/internal/retrieval/embeddings'){res.setHeader('content-type','application/json');res.end(JSON.stringify({model,modelVersion:'1',vectors:[[1,0]]}));return;}
  const data=JSON.parse(body) as {candidates:{id:string;content:string}[]};
  seen=data.candidates.map(c=>c.content);expect(req.headers['x-deep-agent-internal-key']).toBe('trusted-secret');
  if(mode==='failure'){res.writeHead(503);res.end('{}');return;}
  if(mode==='revoke')await asApp(org,c=>c.query("UPDATE segment_text SET lifecycle='revoked' WHERE org_id=$1 AND segment_id=$2",[org,'public-'+org]));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'rank',modelVersion:'1',ids:mode==='foreign-id'?['forged']:data.candidates.map(c=>c.id).reverse()}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error('address');
 const identity={repo:new PgIdentityRepository(db),ids:{next:randomUUID}},index=new PgOrganizationKnowledgeIndex(db,identity);
 const rerank=new LangChainRerankClient({baseUrl:`http://127.0.0.1:${address.port}`,internalKey:'trusted-secret',model:'rank',modelVersion:'1'});
 const hybrid=new OrganizationHybridRetrieval(index,identity,{retriever:new PgSegmentRetriever(db),embeddings:new TableEmbedding(model,'1',{[query]:[1,0]}),rerank});
 source=new OrganizationContextSource(index,identity,{search:async()=>({items:[],scopeMode:'existing-file-retrieval',truncated:false}),read:async()=>{throw new Error('unavailable');}},hybrid);
});
afterAll(async()=>{server?.closeAllConnections();await new Promise<void>(r=>server?server.close(()=>r()):r());await db?.close();await resetOrgs(org,foreign);});
it('runs actual FTS/vector/metadata/claim SQL, canonical permissions, existing RRF and real HTTP rerank',async()=>{
 const result=await source.search(actor,{query,scope:'organization-hybrid',queryTask:'research'});
 expect(result.scopeMode).toBe('organization-index-hybrid');expect(result.retrievalPlan?.map(p=>p.channel)).toEqual(['fts','vector','metadata','claim']);
 expect(result.items.map(x=>x.sourceId).sort()).toEqual(['segment:member-'+org,'segment:public-'+org].sort());
 expect(seen.sort()).toEqual([query+' member',query+' public']);expect(JSON.stringify(result)).not.toContain('hidden statement');
 expect(result.items.every(x=>x.versionId.includes('@sha256:')&&x.citationAnchor.kind==='indexed-segment')).toBe(true);
});
it('cross-project nonmember, foreign, pending, revoked, interview and private bytes never reach reranker',async()=>{
 const result=await source.search({...actor,userId:'bob'},{query,scope:'organization-hybrid'});
 expect(seen).toEqual([query+' public']);expect(result.items.map(x=>x.sourceId)).toEqual(['segment:public-'+org]);
});
it('provider failure and forged returned IDs fail instead of reporting no matches',async()=>{
 for(const value of ['failure','foreign-id'] as const){mode=value;await expect(source.search(actor,{query,scope:'organization-hybrid'})).rejects.toThrow();}mode='normal';
});
it('unresolved graph plan explicitly fails before any external call and default FTS stays available',async()=>{
 seen=[];await expect(source.search(actor,{query:'who decided',scope:'organization-hybrid'})).rejects.toThrow('hybrid_graph_seeds_unavailable');expect(seen).toEqual([]);
 expect((await source.search(actor,{query,scope:'organization-index'})).scopeMode).toBe('organization-index-fts');
});
it('production createApp bridge uses configured hybrid providers and claimed human identity',async()=>{
 const address=server.address();if(!address||typeof address==='string')throw new Error('address');
 const env={KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1',DEEP_AGENT_SERVICE_INTERNAL_KEY:'trusted-secret',KERNEL_DEEP_AGENT_BASE_URL:`http://127.0.0.1:${address.port}`,KERNEL_EMBEDDING_MODEL_ID:model,KERNEL_EMBEDDING_MODEL_VERSION:'1',KERNEL_RERANK_MODEL_ID:'rank',KERNEL_RERANK_MODEL_VERSION:'1'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const thread=randomUUID(),message=randomUUID(),run=randomUUID();
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'bob'});
 await addChatMessage({orgId:org,id:message,threadId:thread,body:'retrieve',authorId:'bob'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('hybrid-agent',$1,'hybrid-agent','Hybrid','enabled','bob',now(),now())",[org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('hybrid-version',$1,'hybrid-agent','v1',$2,'hybrid','{}','test','test','[]','bob',now(),now())",[org,createHash('sha256').update('hybrid').digest('hex')]);
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,'hybrid-agent','hybrid-version','[]','test','test','running',now(),1,now()+interval '10 minutes')",[run,org,thread,message]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 const app=await(await import('../../src/main')).createApp();
 try{
  await app.listen(0,'127.0.0.1');
  const awaitBase=await app.getUrl();
  const invoke=(extra:Record<string,unknown>={})=>fetch(`${awaitBase}/internal/agent-runs/${run}/standard-context/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'trusted-secret'},body:JSON.stringify({orgId:org,attemptId:run+':0',leaseEpoch:1,toolCallId:randomUUID(),toolName:'wx_knowledge_search',toolArgs:{query,scope:'organization-hybrid',queryTask:'research'},...extra})});
  const response=await invoke();expect(response.status).toBe(200);const output=KnowledgeSearchOutput.parse(await response.json());
  expect(output.scopeMode).toBe('organization-index-hybrid');expect(output.items.map(x=>x.sourceId)).toEqual(['segment:public-'+org]);expect(seen).toEqual([query+' public']);
  expect((await invoke({orgId:foreign})).status).toBe(403);expect((await invoke({leaseEpoch:2})).status).toBe(403);
 }finally{await app.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
it('withdrawal while ranking rejects the late result',async()=>{
 mode='revoke';try{await expect(source.search(actor,{query,scope:'organization-hybrid'})).rejects.toThrow('context_source_unavailable');}finally{mode='normal';}
});
