import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {NativeOutputStagingController} from '../../src/interface/controllers/native-output-staging.controller';
import {NATIVE_OUTPUT_STAGING} from '../../src/application/agent-run/native-output-staging';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {PgNativeOutputStaging} from '../../src/infrastructure/agent-run/pg-native-output-staging';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
const org=toOrgId('native-output-'+randomUUID()),parent='run-'+randomUUID();let db:PgDatabase;let root:string;
async function seed(scope: typeof org, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`, [agent,scope]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','queued')`,
    [id,scope,thread,`message-${scope}`,agent,version]);
  });
}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-stage-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
it('stages actual bytes, refuses changed content, replays once and existing writeback creates one artifact version',async()=>{
 let bytes=Buffer.from('actual UTF8 文件');const path='/workspace/a.txt';const objects=new FsObjectStore(root);
 const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'publish-call'};
 const reader=new PgParentRunControlReader(db);
 const authority=new ToolExecutionAuthority(reader,{readPinnedSkills:async()=>[]},{hasGrant:async()=>true,grantForRun:async()=>{},grantStanding:async()=>{},revokeAllForRun:async()=>{}});
 const owner:NativeSessionOwner={provision:async()=>{throw new Error('unused');},release:async()=>{},releaseForRun:async()=>{},resolve:async()=>({sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+60000,interruptOn:{},packageDigest:'b'.repeat(64)})};
 const staging=new PgNativeOutputStaging(db,owner,objects,authority,()=>({read:async()=>({path,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')})}));
 const input={workspacePath:path,title:'a.txt',mediaType:'text/plain' as const,idempotencyKey:'one'};
 const failedObjects={putOnce:async()=>{throw new Error('object write failure');},get:objects.get.bind(objects),head:objects.head.bind(objects)};
 const failing=new PgNativeOutputStaging(db,owner,failedObjects,authority,()=>({read:async()=>({path,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')})}));
 await expect(failing.stage(ctx,input)).rejects.toThrow('object write failure');expect(await staging.listFiles(org,parent)).toEqual([]);
 const denied=new PgNativeOutputStaging(db,owner,objects,{check:async()=>({allowed:false,reason:'approval_required'})},()=>({read:async()=>{throw new Error('must not read');}}));
 await expect(denied.stage(ctx,input)).rejects.toThrow('denied');
 const missing=new PgNativeOutputStaging(db,owner,objects,authority,()=>({read:async()=>{throw new Error('missing file');}}));
 await expect(missing.stage(ctx,input)).rejects.toThrow('missing file');
 class TestModule{};Module({controllers:[NativeOutputStagingController],providers:[{provide:NATIVE_OUTPUT_STAGING,useValue:staging}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='stage-test-key';
 let result: Awaited<ReturnType<typeof staging.stage>>;
 try{
  const url=`${await app.getUrl()}/internal/agent-runs/${parent}/native-artifacts/stage`;
  const body={orgId:org,attemptId:ctx.attemptId,leaseEpoch:1,bindingId:ctx.bindingId,toolCallId:ctx.toolCallId,toolArgs:input};
  const denied=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(denied.status).toBe(401);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'stage-test-key'},body:JSON.stringify(body)});expect(response.status).toBe(200);result=await response.json() as Awaited<ReturnType<typeof staging.stage>>;
 }finally{await app.close();if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}
 expect(result.status).toBe('staged');
 expect(await staging.stage(ctx,input)).toEqual(result);
 const concurrent=await Promise.all([staging.stage(ctx,input),staging.stage(ctx,input)]);expect(concurrent).toEqual([result,result]);
 await expect(staging.stage({...ctx,leaseEpoch:2},input)).rejects.toThrow('denied');
 await expect(staging.stage({...ctx,orgId:toOrgId('other')},input)).rejects.toThrow('denied');
 bytes=Buffer.from('changed');await expect(staging.stage(ctx,input)).rejects.toThrow('conflict');bytes=Buffer.from('actual UTF8 文件');
 await expect(staging.stage(ctx,{...input,title:'another.txt'})).rejects.toThrow('conflict');
 const files=await staging.listFiles(org,parent);expect(files).toHaveLength(1);expect(await objects.get(files[0]!.objectKey)).toEqual(new Uint8Array(bytes));
 const repo=new PgAgentRunRepository(db);await repo.storeOutputAwaitingWriteback(org,parent,{text:'file staged',finalStepSeq:1,files});
 const pending=(await repo.claimWritebackPending(org,1))[0]!;
 const write={runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files};
 await repo.commitWriteback(org,write);await repo.commitWriteback(org,write);
 const versions=await db.withTenant(org,s=>s.query('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(1);
 const attachments=await db.withTenant(org,s=>s.query('SELECT a.id FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id AND m.org_id=a.org_id WHERE m.org_id=$1 AND m.agent_run_id=$2',[org,parent]));expect(attachments.rows).toHaveLength(1);
});
