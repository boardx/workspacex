import {hashDownloadToken} from "../../src/domain/files/download-grant";
import {resolveObjectPath} from "../../src/infrastructure/storage/object-store-path";
import {ARTIFACT_STORE,type ArtifactStore} from "../../src/application/artifacts-steering/ports";
import {SUBTASK_RUN_STORE,type SubtaskRunStore} from "../../src/application/agent-run/subtask-run-queue";
import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,addProjectMember,asApp,asOwner,resetOrgs} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {seedAgentRun,seedToolCallStep} from '../support/agent-run-db';
import {DATABASE_PORT,type DatabasePort} from '../../src/application/ports/database.port';
import {AGENT_RUN_STORE,type AgentRunStore} from '../../src/application/agent-run/ports';
import {OBJECT_STORE,type ObjectStore} from '../../src/application/artifact/ports';
import {TOOL_PERMISSION_GRANT_STORE,type ToolPermissionGrantStore} from '../../src/application/agent-run/tool-permission-grants';
import {TOOL_EXECUTION_AUTHORITY,type ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgNativeOutputStaging} from '../../src/infrastructure/agent-run/pg-native-output-staging';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import {ArtifactDownloadOutput} from '@repo/contracts/standard-artifact-download';
import {RunStatusOutput} from '@repo/contracts/standard-run-status';
import {RunCancelOutput} from '@repo/contracts/standard-run-cancel';
import {toOrgId} from '../../src/domain/org-id';
import type {NestExpressApplication} from '@nestjs/platform-express';
const org=toOrgId('native-entry-'+randomUUID()),parent='parent-'+randomUUID(),target='output-'+randomUUID();
const thread='thread-'+randomUUID(),otherOrg=toOrgId('entry-other-'+randomUUID());
let app:NestExpressApplication,db:DatabasePort,runs:AgentRunStore,objects:ObjectStore,root:string,base:string;
let artifact:{artifactId:string;versionId:string},key:string;
const bytes=Buffer.from('Native artifact: actual staged bytes 中文\n');
const names=['KERNEL_ALLOW_TEST_PRINCIPAL','KERNEL_QUIET','DEEP_AGENT_SERVICE_INTERNAL_KEY','WORKSPACEX_OBJECT_ROOT'];
const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const invoke=(toolName:string,toolArgs:unknown,overrides:Record<string,unknown>={})=>fetch(base+`/internal/agent-runs/${parent}/standard-${toolName==='wx_artifact_download'?'artifact-download':toolName==='wx_run_status'?'run-status':'run-cancel'}/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'entry-test-key'},body:JSON.stringify({orgId:org,attemptId:`${parent}:0`,leaseEpoch:1,toolCallId:randomUUID(),toolName,toolArgs,...overrides})});
const redeem=(url:string,user='actor')=>fetch(base+new URL(url).pathname,{headers:{'x-kernel-test-principal':`${user}:${org}`}});
async function issue(){const response=await invoke('wx_artifact_download',{...artifact,purpose:'download'});expect(response.status,await response.clone().text()).toBe(200);return ArtifactDownloadOutput.parse(await response.json());}
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();root=await mkdtemp(join(tmpdir(),'wx-entry-files-'));
 process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='entry-test-key';process.env.WORKSPACEX_OBJECT_ROOT=root;
 const {createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();
 db=app.get(DATABASE_PORT);runs=app.get(AGENT_RUN_STORE);objects=app.get(OBJECT_STORE);
 await seedOrg({orgId:otherOrg,projectId:'project-'+otherOrg});await addOrgMember(otherOrg,'actor','consultant',null);
 await seedOrg({orgId:org,projectId:'project-'+org});await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'intruder','consultant',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 for(const id of [parent,target]){
  await seedAgentRun({orgId:org,id,threadId:thread,authorId:'actor',status:'running'});
  await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,id]));
  await asApp(org,c=>c.query("UPDATE agent_runs SET started_at=now()-interval '1 second',lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE org_id=$1 AND id=$2",[org,id]));
 }
 const grants=app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE);
 for(const tool of ['wx_artifact_download','wx_run_cancel'])await grants.grantForRun(org,parent,tool);
 await grants.grantForRun(org,target,'wx_artifact_publish');
 const owner:NativeSessionOwner={resolve:async()=>({sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+60000,interruptOn:{},packageDigest:'a'.repeat(64),inputs:[]}),provision:async()=>{throw new Error('unused');},release:async()=>{},releaseForRun:async()=>{}};
 const staging=new PgNativeOutputStaging(db,owner,objects,app.get<ToolExecutionAuthority>(TOOL_EXECUTION_AUTHORITY),()=>({read:async path=>({path,contentBase64:bytes.toString('base64'),sizeBytes:bytes.length})}));
 await staging.stage({orgId:org,parentRunId:target,attemptId:`${target}:0`,leaseEpoch:1,bindingId:randomUUID(),toolCallId:'publish-real'}, {workspacePath:'/workspace/result.txt',title:'result.txt',mediaType:'text/plain',idempotencyKey:'publish'});
 const files=await staging.listFiles(org,target);key=files[0]!.objectKey;
 await runs.storeOutputAwaitingWriteback(org,target,{text:'generated',finalStepSeq:1,files});
 const pending=(await runs.claimWritebackPending(org,1))[0]!;
 await runs.commitWriteback(org,{runId:target,threadId:thread,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:createHash('sha256').update('generated').digest('hex'),files});
 const row=await db.withTenant(org,async s=>(await s.query<{artifact_id:string;id:string}>('SELECT artifact_id,id FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,target])).rows[0]!);
 artifact={artifactId:row.artifact_id,versionId:row.id};
},60000);
afterAll(async()=>{await app?.close();await resetOrgs(org,otherOrg);if(root)await rm(root,{recursive:true,force:true});for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
it('production status entry returns visible staged/writeback artifact ids and denies stale identities',async()=>{
 const hiddenThread='hidden-'+randomUUID();await addChatThread({orgId:org,id:hiddenThread,projectId:null,visibilityScope:'private',createdBy:'intruder'});
 const step=await seedToolCallStep({orgId:org,runId:target,seq:3,toolName:'fixture-hidden-output'});
 await app.get<ArtifactStore>(ARTIFACT_STORE).createArtifact(org,{id:'hidden-artifact-'+randomUUID(),threadId:hiddenThread,name:'private source',kind:'other',producedByRunId:target,producedByStepId:step,changeNote:'private',storageKey:key,sizeBytes:bytes.length});
 const response=await invoke('wx_run_status',{runId:target});expect(response.status,await response.clone().text()).toBe(200);
 expect(RunStatusOutput.parse(await response.json()).artifactRefs).toEqual([artifact]);
 for(const override of [{attemptId:'stale'},{leaseEpoch:99},{orgId:'other-org'}])expect((await invoke('wx_run_status',{runId:target},override)).status).toBe(403);
});
it('T020 stage→writeback→T021 mints a subject-bound one-use link and HTTP returns exact bytes',async()=>{
 const link=await issue();expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
 expect((await redeem(link.downloadRef,'intruder')).status).toBe(404);
 const results=await Promise.all([redeem(link.downloadRef),redeem(link.downloadRef)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 const winner=results.find(r=>r.status===200)!;expect(winner.headers.get('content-disposition')).toBe('attachment');expect(Buffer.from(await winner.arrayBuffer())).toEqual(bytes);
});
it('rechecks source access at redemption and rollback preserves the grant for its rightful principal',async()=>{
 const link=await issue();await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'intruder']));
 expect((await redeem(link.downloadRef)).status).toBe(404);
 await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'actor']));
 expect((await redeem(link.downloadRef)).status).toBe(200);
});
it('expired grant and changed bytes do not produce a successful download',async()=>{
 const expired=await issue();await asApp(org,c=>c.query("UPDATE download_grants SET expires_at=now()-interval '1 second' WHERE org_id=$1 AND consumed_at IS NULL",[org]));expect((await redeem(expired.downloadRef)).status).toBe(410);
 const link=await issue();await writeFile(resolveObjectPath(root,key),Buffer.from('tampered'));expect((await redeem(link.downloadRef)).status).toBe(422);
 await writeFile(resolveObjectPath(root,key),bytes);expect((await redeem(link.downloadRef)).status).toBe(200);
});
it('keeps existing file-domain grants and JSON redemption compatible',async()=>{
 const id='legacy-'+randomUUID(),versionId=id+'-v1';
 await addProjectMember(org,'project-'+org,'actor','facilitator',null,true);
 await asApp(org,async c=>{
  await c.query("INSERT INTO artifacts(id,org_id,project_id,source,title,created_by,synthesized) VALUES($1,$2,$3,'upload','legacy','actor',false)",[id,org,'project-'+org]);
  await c.query("INSERT INTO artifact_versions(id,org_id,artifact_id,version_number,object_storage_key,content_hash,mime,size_bytes,pinned_by) VALUES($1,$2,$3,1,$4,$5,'text/plain',$6,'actor')",[versionId,org,id,key,createHash('sha256').update(bytes).digest('hex'),bytes.length]);
 });
 const response=await invoke('wx_artifact_download',{artifactId:id,versionId,purpose:'download'});expect(response.status,await response.clone().text()).toBe(200);
 const link=ArtifactDownloadOutput.parse(await response.json());const result=await redeem(link.downloadRef);expect(result.status).toBe(200);
 expect(await result.json()).toMatchObject({objectKey:key,artifactId:id,versionId,contentDisposition:'attachment'});
});
it('an issued Agent grant cannot downgrade to legacy JSON when its immutable source is removed',async()=>{
 const link=await issue();
 const migration=await readFile(join(process.cwd(),'migrations/20260909150000_download_grant_source_kind.sql'),'utf8');
 await asOwner(async c=>{await c.query(migration);await c.query(migration);});
 const tagged=await db.withTenant(org,async s=>(await s.query<{source_kind:string}>('SELECT source_kind FROM download_grants WHERE org_id=$1 AND version_id=$2',[org,artifact.versionId])).rows);
 expect(tagged.every(row=>row.source_kind==='agent')).toBe(true);
 const crossToken=randomUUID();
 await asOwner(c=>c.query(`INSERT INTO download_grants(id,org_id,artifact_id,version_id,object_key,principal_user_id,permission_decision_id,purpose,token_hash,expires_at,source_kind)
  SELECT $1,$2,artifact_id,version_id,object_key,'actor',permission_decision_id,purpose,$3,expires_at,'agent' FROM download_grants WHERE org_id=$4 AND version_id=$5 AND token_hash=$6 LIMIT 1`,[randomUUID(),otherOrg,hashDownloadToken(crossToken),org,artifact.versionId,hashDownloadToken(new URL(link.downloadRef).pathname.split('/').at(-1)!)]));
 const cross=await fetch(base+'/downloads/'+crossToken,{headers:{'x-kernel-test-principal':`actor:${otherOrg}`}});
 expect(cross.status).toBe(404);expect(await cross.text()).not.toContain(key);
 // Test-only removal simulates administrative loss. The normal runtime has no deletion permission.
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('ALTER TABLE agent_artifact_versions DISABLE TRIGGER agent_artifact_versions_append_only_trg');
  await c.query('DELETE FROM agent_artifact_versions WHERE org_id=$1 AND id=$2',[org,artifact.versionId]);
  await c.query('ALTER TABLE agent_artifact_versions ENABLE TRIGGER agent_artifact_versions_append_only_trg');
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}});
 const response=await redeem(link.downloadRef);expect(response.status).toBe(404);expect(await response.text()).not.toContain(key);
});
it('native cancel delegates durable queued parent/child cancellation and cannot cancel another requester run',async()=>{
 const queued='queued-'+randomUUID();await seedAgentRun({orgId:org,id:queued,threadId:thread,authorId:'actor',status:'queued'});
 const children=app.get<SubtaskRunStore>(SUBTASK_RUN_STORE);
 const child=await children.enqueue(org,{parentRunId:queued,description:'must not start',idempotencyKey:'child'});
 const response=await invoke('wx_run_cancel',{runId:queued,idempotencyKey:'cancel'});expect(response.status,await response.clone().text()).toBe(202);
 expect(RunCancelOutput.parse(await response.json())).toMatchObject({cancellationRequested:true,finalStatus:'cancelled'});
 expect((await invoke('wx_run_cancel',{runId:queued,idempotencyKey:'cancel'})).status).toBe(202);
 expect((await children.get(org,child.id))?.status).toBe('cancelled');
 await children.complete(org,child.id,'late result');expect((await children.get(org,child.id))?.result).toBeNull();
 await expect(children.enqueue(org,{parentRunId:queued,description:'late child',idempotencyKey:'late'})).rejects.toThrow();
 const other='other-'+randomUUID();await seedAgentRun({orgId:org,id:other,threadId:thread,authorId:'intruder',status:'queued'});
 expect((await invoke('wx_run_cancel',{runId:other,idempotencyKey:'not-owned'})).status).toBe(403);
 await asApp(org,c=>c.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[org,parent]));
 expect((await invoke('wx_run_status',{runId:target})).status).toBe(403);
});
