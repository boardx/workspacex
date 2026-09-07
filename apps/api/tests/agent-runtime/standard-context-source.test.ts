import {extractedObjectKey} from '../../src/application/chat/attachment-extraction-worker';
import {KnowledgeSearchOutput,ProjectListOutput,ProjectReadOutput} from '@repo/contracts/standard-context-tools';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,addProjectMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgFileRetrieval} from '../../src/infrastructure/agent-run/pg-file-retrieval';
import {StandardContextSource} from '../../src/infrastructure/agent-run/standard-context-source';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('context-'+randomUUID()),project='project-'+org;
let db:PgDatabase,source:StandardContextSource,root:string,store:FsObjectStore;
const actor={orgId:org,userId:'alice',threadId:'personal',projectId:null};
async function attachment(id:string,thread:string,projectId:string|null,owner='alice'){
 await addChatThread({orgId:org,id:thread,projectId,visibilityScope:projectId?'plenary':'private',createdBy:owner});
 await addChatMessage({orgId:org,id:'message-'+id,threadId:thread,body:'attachment',authorId:owner});
 const text='NEEDLE actual immutable extraction 中文 '+id;
 await store.putOnce(extractedObjectKey(org,id),Buffer.from(text),'text/markdown');
 await asApp(org,c=>c.query(`INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes,extraction_status,extracted_excerpt,extracted_ref) VALUES($1,$2,$3,$4,'secret-storage','same title','text/markdown',100,'extracted','NEEDLE stale indexed excerpt',$5)`,[id,org,thread,'message-'+id,extractedObjectKey(org,id)]));
 return text;
}
beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'context-'));store=new FsObjectStore(root);
 await seedOrg({orgId:org,projectId:project});await addOrgMember(org,'alice','consultant',null);await addOrgMember(org,'bob','consultant',null);await addProjectMember(org,project,'alice','member',null);
 source=new StandardContextSource(new PgFileRetrieval(db),store,{repo:new PgIdentityRepository(db),chat:new PgChatRepository(db),ids:{next:()=>randomUUID()}});
 await attachment('own','personal',null);await attachment('other','bob-personal',null,'bob');await attachment('project-file','project-thread',project);
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
it('real FTS → immutable FsObjectStore bytes → real ID and digest, never storage key or stale excerpt',async()=>{
 const output=await source.search(actor,{query:'NEEDLE'});expect(output.items).toHaveLength(1);
 const hit=output.items[0]!;expect(hit.sourceId).toBe('chat-attachment:own');expect(hit.excerpt).toContain('actual immutable');expect(JSON.stringify(output)).not.toContain('chat-attachments-extracted/');
 expect(hit.versionId).toBe('sha256:'+createHash('sha256').update('NEEDLE actual immutable extraction 中文 own').digest('hex'));
 const read=await source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId});expect(read.content).toContain('中文 own');expect(read.citationAnchor.messageId).toBe('message-own');
 await expect(source.read(actor,{sourceId:hit.sourceId,versionId:'sha256:'+'0'.repeat(64)})).rejects.toThrow();
});
it('private other-user IDs and foreign tenant cannot be read or searched',async()=>{
 await expect(source.read(actor,{sourceId:'chat-attachment:other',versionId:'anything'})).rejects.toThrow();
 const output=await source.search({...actor,orgId:toOrgId('nonexistent-org')},{query:'NEEDLE'});expect(output.items).toEqual([]);
});
it('explicit authorized project scope works and remains required for later read',async()=>{
 const output=await source.search(actor,{query:'NEEDLE',projectId:project});expect(output.items).toHaveLength(1);const hit=output.items[0]!;
 expect(hit.sourceId).toBe('chat-attachment:project-file');expect((await source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId,projectId:project})).content).toContain('project-file');
 await expect(source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();
 await expect(source.search({...actor,userId:'bob',threadId:'bob-personal'},{query:'NEEDLE',projectId:project})).rejects.toThrow();
});
it('missing, oversize and invalid UTF8 objects fail rather than returning invented content',async()=>{
 const hit=(await source.search(actor,{query:'NEEDLE'})).items[0]!;
 const originalKey=extractedObjectKey(org,'own');
 await asApp(org,c=>c.query("UPDATE chat_message_attachments SET extracted_ref='foreign-secret-key' WHERE id='own' AND org_id=$1",[org]));
 await expect(source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();
 await asApp(org,c=>c.query("UPDATE chat_message_attachments SET extracted_ref=$2 WHERE id='own' AND org_id=$1",[org,originalKey]));
 const visibility={repo:new PgIdentityRepository(db),chat:new PgChatRepository(db),ids:{next:()=>randomUUID()}};
 let transferred=false;
 const oversize=new StandardContextSource(new PgFileRetrieval(db),{putOnce:async()=>{},head:async()=>({sizeBytes:4194305,mime:'text/plain'}),get:async()=>{transferred=true;return null;}},visibility);
 await expect(oversize.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();expect(transferred).toBe(false);
 const invalid=new StandardContextSource(new PgFileRetrieval(db),{putOnce:async()=>{},head:async()=>({sizeBytes:1,mime:'text/plain'}),get:async()=>new Uint8Array([255])},visibility);
 await expect(invalid.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();
 const missing=new StandardContextSource(new PgFileRetrieval(db),{putOnce:async()=>{},head:async()=>null,get:async()=>null},visibility);
 await expect(missing.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();
});
it('revocation after search is checked again on read',async()=>{
 const hit=(await source.search(actor,{query:'NEEDLE',projectId:project})).items[0]!;
 await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,project,'alice']));
 await expect(source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId,projectId:project})).rejects.toThrow();
});
it('production HTTP bridge uses real run requester/authority and project API parity',async()=>{
 const env={KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1',KERNEL_ALLOW_TEST_PRINCIPAL:'1',DEEP_AGENT_SERVICE_INTERNAL_KEY:'context-test-key',WORKSPACEX_OBJECT_ROOT:root};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 await addProjectMember(org,project,'alice','member',null);
 const run='context-run';
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('context-agent',$1,'context-agent','Context','enabled','alice',now(),now())",[org]);
  await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('context-version',$1,'context-agent','v1',$2,'context','{}','test','test','[]','alice',now(),now())`,[org,createHash('sha256').update('context').digest('hex')]);
  await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,'personal','message-own','context-agent','context-version','[]','test','test','running',now(),1,now()+interval '10 minutes')`,[run,org]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 const app=await (await import('../../src/main')).createApp();
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const invoke=(name:string,args:unknown,extra:Record<string,unknown>={},key='context-test-key')=>fetch(`${base}/internal/agent-runs/${run}/standard-context/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify({orgId:org,attemptId:run+':0',leaseEpoch:1,toolCallId:randomUUID(),toolName:name,toolArgs:args,...extra})});
  // Shared risk registry marks these authorized read-only tools L0; no synthetic grant is needed.
  const response=await invoke('wx_knowledge_search',{query:'NEEDLE'});expect(response.status).toBe(200);const found=KnowledgeSearchOutput.parse(await response.json());expect(found.items[0]!.sourceId).toBe('chat-attachment:own');
  expect((await invoke('wx_knowledge_read',{sourceId:found.items[0]!.sourceId,versionId:found.items[0]!.versionId})).status).toBe(200);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE',userId:'bob'})).status).toBe(400);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE'},{leaseEpoch:2})).status).toBe(403);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE'},{orgId:'other'})).status).toBe(403);
  expect((await invoke('wx_project_list',{}, {},'bad-key')).status).toBe(401);
  const headers={'x-kernel-test-principal':`alice:${org}`};
  const projects=await invoke('wx_project_list',{});expect(projects.status).toBe(200);
  const canonicalList=await fetch(`${base}/projects?orgId=${org}`,{headers});expect(canonicalList.status).toBe(200);expect(ProjectListOutput.parse(await projects.json()).projects).toEqual(await canonicalList.json());
  const overview=await invoke('wx_project_read',{projectId:project});expect(overview.status).toBe(200);
  const canonicalOverview=await fetch(`${base}/projects/${project}/overview?orgId=${org}`,{headers});expect(canonicalOverview.status).toBe(200);expect(ProjectReadOutput.parse(await overview.json()).overview).toEqual(await canonicalOverview.json());
  await asApp(org,c=>c.query("UPDATE chat_messages SET author_kind='agent' WHERE id='message-own' AND org_id=$1",[org]));
  expect((await invoke('wx_project_list',{})).status).toBe(403);
  await asApp(org,c=>c.query("UPDATE chat_messages SET author_kind='human' WHERE id='message-own' AND org_id=$1",[org]));
  await asApp(org,c=>c.query("UPDATE chat_threads SET created_by='bob' WHERE id='personal' AND org_id=$1",[org]));
  expect((await invoke('wx_project_list',{})).status).toBe(403);
 }finally{await app.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
