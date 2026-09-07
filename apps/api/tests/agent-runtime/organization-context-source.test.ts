import {randomUUID,createHash} from 'node:crypto';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {seedOrg,addOrgMember,addProjectMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {KnowledgeSearchOutput,KnowledgeReadOutput} from '@repo/contracts/standard-context-tools';
import {indexSegment} from '../support/retrieval-fixtures';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgOrganizationKnowledgeIndex} from '../../src/infrastructure/retrieval/pg-organization-knowledge-index';
import {OrganizationContextSource} from '../../src/infrastructure/agent-run/organization-context-source';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('index-'+randomUUID()),foreign=toOrgId('foreign-'+randomUUID()),project='project-'+org;
const actor={orgId:org,userId:'alice',threadId:'trusted-thread',projectId:null};
let db:PgDatabase,source:OrganizationContextSource;
const files={search:vi.fn(async()=>({items:[],scopeMode:'existing-file-retrieval' as const,truncated:false})),read:vi.fn(async()=>{throw new Error('file source unavailable');})};
const search=()=>source.search(actor,{query:'NEEDLE',scope:'organization-index',limit:20});
async function insert(id:string,opts:Partial<Parameters<typeof indexSegment>[0]>={}){
 await indexSegment({orgId:org,segmentId:id,artifactId:'a-'+id,content:'NEEDLE immutable evidence '+id,sourceType:'file',layer:'org',...opts});
 if(opts.projectId)await asApp(org,c=>c.query('UPDATE artifacts SET project_id=$2 WHERE id=$1',['a-'+id,opts.projectId]));
}
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 await seedOrg({orgId:org,projectId:project});await seedOrg({orgId:foreign,projectId:'project-'+foreign});
 await addOrgMember(org,'alice','consultant',null);await addOrgMember(org,'bob','consultant',null);
 await addProjectMember(org,project,'alice','member',null);
 const identity={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()}};
 source=new OrganizationContextSource(new PgOrganizationKnowledgeIndex(db,identity),identity,files);
 await insert('public');await insert('member',{projectId:project,layer:'project'});
 await insert('private',{private:true,layer:'personal'});
 await insert('interview',{sourceType:'interview'});
 await insert('withdrawn',{lifecycle:'revoked'});
 await insert('synthesized');await asApp(org,c=>c.query('UPDATE artifacts SET synthesized=true WHERE id=$1',['a-synthesized']));
 await insert('confidential');await asApp(org,c=>c.query('UPDATE artifacts SET confidential=true WHERE id=$1',['a-confidential']));
 await indexSegment({orgId:foreign,segmentId:'foreign',artifactId:'a-foreign',content:'NEEDLE foreign secret',sourceType:'file',layer:'org'});
});
afterAll(async()=>{await db?.close();await resetOrgs(org,foreign);});
it('returns actual artifact/version/anchor and digest from existing primary file index',async()=>{
 const output=await search();expect(output.scopeMode).toBe('organization-index-fts');expect(output.coverage).toBe('primary-file-index');
 expect(output.items.map(i=>i.sourceId).sort()).toEqual(['segment:member','segment:public']);
 const hit=output.items.find(i=>i.sourceId==='segment:public')!;
 expect(hit.versionId).toBe('public-v1@sha256:'+createHash('sha256').update('NEEDLE immutable evidence public').digest('hex'));
 expect(hit.citationAnchor).toEqual({kind:'indexed-segment',segmentId:'public',artifactId:'a-public',artifactVersionId:'public-v1',projectId:null,anchor:{kind:'page',locator:'1'}});
 const read=await source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId});expect(read.content).toBe('NEEDLE immutable evidence public');expect(read.contentKind).toBe('indexed-segment');
 expect(JSON.stringify(output)).not.toContain('object_key');
});
it('organization scope still checks each canonical source project membership',async()=>{
 const output=await source.search({...actor,userId:'bob'},{query:'NEEDLE',scope:'organization-index'});
 expect(output.items.map(i=>i.sourceId)).toEqual(['segment:public']);
 const hit=(await search()).items.find(i=>i.sourceId==='segment:member')!;
 await expect(source.read({...actor,userId:'bob'},{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow('context_source_unavailable');
 await expect(source.search({...actor,userId:'bob'},{query:'NEEDLE',scope:'organization-index',projectId:project})).rejects.toThrow();
});
it('known foreign/private/unsupported source identifiers cannot bypass search exclusions',async()=>{
 for(const id of ['foreign','private','interview','withdrawn','synthesized','confidential'])await expect(source.read(actor,{sourceId:'segment:'+id,versionId:id+'-v1@sha256:fake'})).rejects.toThrow();
});
it('index bytes changing without a new artifact version invalidates the prior citation',async()=>{
 await insert('changing');const hit=(await search()).items.find(i=>i.sourceId==='segment:changing')!;
 await asApp(org,c=>c.query('UPDATE segment_text SET content=$2 WHERE segment_id=$1',['changing','NEEDLE changed evidence']));
 await expect(source.read(actor,{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow('context_source_unavailable');
 const next=(await search()).items.find(i=>i.sourceId===hit.sourceId)!;expect(next.versionId).not.toBe(hit.versionId);
 await asApp(org,c=>c.query("UPDATE segment_text SET lifecycle='revoked' WHERE segment_id=$1",['changing']));
});
it('revoked project membership denies an already-issued citation',async()=>{
 await addProjectMember(org,project,'bob','member',null);
 const hit=(await source.search({...actor,userId:'bob'},{query:'NEEDLE',scope:'organization-index'})).items.find(i=>i.sourceId==='segment:member')!;
 await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,project,'bob']));
 await expect(source.read({...actor,userId:'bob'},{sourceId:hit.sourceId,versionId:hit.versionId})).rejects.toThrow();
});
it('default attachment profile is preserved through the existing source',async()=>{
 expect((await source.search(actor,{query:'NEEDLE'})).scopeMode).toBe('existing-file-retrieval');expect(files.search).toHaveBeenCalledWith(actor,{query:'NEEDLE'});
});

it('production HTTP uses the claimed human run and rejects forged tenant, lease and source access',async()=>{
 const env={KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1',KERNEL_ALLOW_TEST_PRINCIPAL:'1',DEEP_AGENT_SERVICE_INTERNAL_KEY:'organization-index-test'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const run='index-run-'+randomUUID(),thread='index-thread-'+randomUUID(),message='index-message-'+randomUUID();
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'bob'});
 await addChatMessage({orgId:org,id:message,threadId:thread,body:'retrieve',authorId:'bob'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('index-agent',$1,'index-agent','Index','enabled','bob',now(),now())",[org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('index-version',$1,'index-agent','v1',$2,'index','{}','test','test','[]','bob',now(),now())",[org,createHash('sha256').update('index').digest('hex')]);
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,'index-agent','index-version','[]','test','test','running',now(),1,now()+interval '10 minutes')",[run,org,thread,message]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 const app=await (await import('../../src/main')).createApp();
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const invoke=(toolName:string,toolArgs:unknown,extra:Record<string,unknown>={})=>fetch(`${base}/internal/agent-runs/${run}/standard-context/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'organization-index-test'},body:JSON.stringify({orgId:org,attemptId:run+':0',leaseEpoch:1,toolCallId:randomUUID(),toolName,toolArgs,...extra})});
  const response=await invoke('wx_knowledge_search',{query:'NEEDLE',scope:'organization-index'});expect(response.status).toBe(200);
  const output=KnowledgeSearchOutput.parse(await response.json());expect(output.items.map(i=>i.sourceId)).toEqual(['segment:public']);
  const hit=output.items[0]!;const read=await invoke('wx_knowledge_read',{sourceId:hit.sourceId,versionId:hit.versionId});expect(read.status).toBe(200);expect(KnowledgeReadOutput.parse(await read.json()).contentKind).toBe('indexed-segment');
  const member=(await search()).items.find(i=>i.sourceId==='segment:member')!;
  expect((await invoke('wx_knowledge_read',{sourceId:member.sourceId,versionId:member.versionId})).ok).toBe(false);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE',scope:'organization-index',userId:'alice'})).status).toBe(400);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE',scope:'organization-index'},{orgId:foreign})).status).toBe(403);
  expect((await invoke('wx_knowledge_search',{query:'NEEDLE',scope:'organization-index'},{leaseEpoch:2})).status).toBe(403);
 }finally{await app.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
