import {SubtaskSpawnOutput} from '@repo/contracts/standard-subtask-tools';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {StandardSubtaskToolsController} from '../../src/interface/controllers/standard-subtask-tools.controller';
import {STANDARD_SUBTASK_SERVICE} from '../../src/application/agent-run/standard-subtask-tools';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {SubtaskRunExecutor} from '../../src/infrastructure/agent-run/subtask-run-executor';
import {PgSubtaskRunStore} from '../../src/infrastructure/agent-run/pg-subtask-run-store';
import {PgFileRetrieval} from '../../src/infrastructure/agent-run/pg-file-retrieval';
import {StandardContextSource} from '../../src/infrastructure/agent-run/standard-context-source';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {extractedObjectKey} from '../../src/application/chat/attachment-extraction-worker';
import {DefaultStandardSubtaskService,StandardSubtaskContextResolver} from '../../src/application/agent-run/standard-subtask-tools';
import {toOrgId} from '../../src/domain/org-id';
// #2989: `agent_runs.id` is a GLOBAL primary key (org_id is not part of it), so a hardcoded
// run id collides with any other file that picks the same literal, however different the org.
const org=toOrgId('native-child-'+randomUUID()),parent='parent-'+randomUUID(),thread='thread-'+randomUUID();
let db:PgDatabase,root:string,store:PgSubtaskRunStore,sources:StandardSubtaskContextResolver,service:DefaultStandardSubtaskService;
const text='Private source: synthetic revenue 42';
const reference={sourceId:'chat-attachment:original',versionId:'sha256:'+createHash('sha256').update(text).digest('hex')};
const context={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'call'};
const input=(key:string)=>({description:'Summarize',contextRefs:[JSON.stringify(reference)],idempotencyKey:key});
const kick=vi.fn();
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'native-child-'));
 await seedOrg({orgId:org,projectId:'project'});await addOrgMember(org,'alice','consultant',null);await addOrgMember(org,'bob','consultant',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'alice'});
 await addChatMessage({orgId:org,id:'message',threadId:thread,body:'parent',authorId:'alice'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('agent',$1,'agent','Agent','enabled','alice',now(),now())",[org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('version',$1,'agent','v1',$2,'fixed','{}','test','test','[]','alice',now(),now())",[org,createHash('sha256').update('fixed').digest('hex')]);
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,'message','agent','version','[]','test','test','queued')",[parent,org,thread]);
 });
 const objects=new FsObjectStore(root),key=extractedObjectKey(org,'original');await objects.putOnce(key,Buffer.from(text),'text/markdown');
 await asApp(org,c=>c.query("INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes,extraction_status,extracted_excerpt,extracted_ref) VALUES('original',$1,$2,'message','original-object','source.txt','text/plain',42,'extracted','Private source: synthetic revenue 42',$3)",[org,thread,key]));
 const visibility={repo:new PgIdentityRepository(db),chat:new PgChatRepository(db),ids:{next:()=>randomUUID()}};
 const source=new StandardContextSource(new PgFileRetrieval(db),objects,visibility);
 sources=new StandardSubtaskContextResolver(new PgAgentRunRepository(db),visibility,source);
 store=new PgSubtaskRunStore(db);
 // Owner/authority transport gates are deliberately isolated here; real source ACL and queue are PostgreSQL-backed.
 service=new DefaultStandardSubtaskService({resolve:async()=>({} as never)},{check:async()=>({allowed:true} as never)},sources,store,{kick});
},120000);
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
it('current authorized bytes are validated, only refs persist, concurrent replay shares actual terminal state',async()=>{
 const pair=await Promise.all([service.spawn(context,input('same')),service.spawn({...context,toolCallId:'other'},input('same'))]);
 expect(pair[0]).toEqual(pair[1]);expect(pair[0]!.status).toBe('queued');
 const row=await store.get(org,pair[0]!.childRunId);expect(row!.context).not.toContain(text);expect(row!.context).toContain(reference.versionId);
 expect(await sources.prepare(org,row!)).toContain(text);
 await store.claimQueued(org,1);await store.complete(org,row!.id,'actual result');
 expect((await service.spawn(context,input('same'))).status).toBe('completed');
 await expect(service.spawn(context,{...input('same'),description:'different'})).rejects.toThrow();
});
it('malformed, unknown version, cross-tenant and unauthorized source reject whole enqueue',async()=>{
 const before=(await store.listByParentRun(org,parent)).length;
 for(const refs of [['not-json'],[JSON.stringify({...reference,orgId:'forged'})],[JSON.stringify({...reference,versionId:'unknown'})],[JSON.stringify({...reference,sourceId:'chat-attachment:missing'})]]){
  await expect(service.spawn(context,{...input(randomUUID()),contextRefs:refs})).rejects.toThrow();
 }
 await expect(service.spawn({...context,orgId:toOrgId('foreign')},input('foreign'))).rejects.toThrow();
 expect(await store.listByParentRun(org,parent)).toHaveLength(before);
});
it('permission revoked after enqueue is checked before deferred source consumption',async()=>{
 const spawned=await service.spawn(context,input('revoked')),row=await store.get(org,spawned.childRunId);
 await asApp(org,c=>c.query("UPDATE chat_threads SET created_by='bob' WHERE org_id=$1 AND id=$2",[org,thread]));
 await expect(sources.prepare(org,row!)).rejects.toThrow();
 const before=(await store.listByParentRun(org,parent)).length;
 await expect(service.spawn(context,input('late'))).rejects.toThrow();
 expect(await store.listByParentRun(org,parent)).toHaveLength(before);
 await asApp(org,c=>c.query("UPDATE chat_threads SET created_by='alice' WHERE org_id=$1 AND id=$2",[org,thread]));
 expect(await sources.prepare(org,row!)).toContain(text);
});

it('executor rechecks deferred permissions and fails without calling model; legacy context remains unchanged',async()=>{
 const created=await service.spawn(context,input('execute-denied'));
 await asApp(org,c=>c.query("UPDATE chat_threads SET created_by='bob' WHERE org_id=$1 AND id=$2",[org,thread]));
 const complete=vi.fn();
 const executor=new SubtaskRunExecutor(store,db,{complete} as never,{info:()=>{},warn:()=>{},error:()=>{}} as never,false,new Map([['test',1000]]),undefined,sources);
 await executor.tick(org);
 expect((await store.get(org,created.childRunId))?.status).toBe('failed');expect(complete).not.toHaveBeenCalled();
 expect(await sources.prepare(org,{context:'legacy unchanged'} as never)).toBe('legacy unchanged');
 await asApp(org,c=>c.query("UPDATE chat_threads SET created_by='alice' WHERE org_id=$1 AND id=$2",[org,thread]));
});
it('truncated source and refused execution authority never enqueue',async()=>{
 const before=(await store.listByParentRun(org,parent)).length;
 const valid=JSON.parse(await sources.read(org,parent,[reference])).sources[0];
 const visibility={repo:new PgIdentityRepository(db),chat:new PgChatRepository(db),ids:{next:()=>randomUUID()}};
 const truncated=new StandardSubtaskContextResolver(new PgAgentRunRepository(db),visibility,{read:async()=>({...valid,truncated:true})});
 const subject=new DefaultStandardSubtaskService({resolve:async()=>({} as never)},{check:async()=>({allowed:true} as never)},truncated,store,{kick});
 await expect(subject.spawn(context,input('truncated'))).rejects.toThrow('subtask_context_incomplete_or_changed');
 const refused=new DefaultStandardSubtaskService({resolve:async()=>{throw new Error('must not resolve');}},{check:async()=>({allowed:false,reason:'lease_lost'})},sources,store,{kick});
 await expect(refused.spawn(context,input('denied'))).rejects.toThrow('subtask_spawn_denied');
 expect(await store.listByParentRun(org,parent)).toHaveLength(before);
});

it('real HTTP validates callback identity and source references before queue write',async()=>{
 const old=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='synthetic-subtask-key';
 @Module({controllers:[StandardSubtaskToolsController],providers:[{provide:STANDARD_SUBTASK_SERVICE,useValue:service}]}) class TestModule{}
 const app=await NestFactory.create(TestModule,{logger:false});
 try{
  await app.listen(0,'127.0.0.1');const url=(await app.getUrl())+'/internal/agent-runs/'+parent+'/subtasks/spawn';
  const invoke=(args:unknown,key='synthetic-subtask-key')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify({orgId:org,attemptId:context.attemptId,leaseEpoch:1,bindingId:context.bindingId,toolCallId:'http-call',toolName:'spawn_async_task',toolArgs:args})});
  expect((await invoke(input('http'),'wrong')).status).toBe(401);
  expect((await invoke({...input('http'),userId:'forged'})).status).toBe(400);
  expect((await invoke({...input('http'),contextRefs:['not-json']})).status).toBe(503);
  const response=await invoke(input('http'));expect(response.status).toBe(200);const first=SubtaskSpawnOutput.parse(await response.json());expect(first.status).toBe('queued');
  expect(await (await invoke(input('http'))).json()).toEqual(first);
  const rows=await store.listByParentRun(org,parent);expect(rows.filter(r=>r.id===first.childRunId)).toHaveLength(1);
 }finally{await app.close();if(old===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=old;}
});
