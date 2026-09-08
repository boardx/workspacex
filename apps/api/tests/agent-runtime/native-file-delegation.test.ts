import 'reflect-metadata';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Module,type FactoryProvider} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {RunInterjectionController} from '../../src/interface/controllers/run-interjection.controller';
import {INTERJECTION_STORE} from '../../src/application/agent-run/interjection-store';
import {AGENT_RUN_STORE} from '../../src/application/agent-run/ports';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgInterjectionStore} from '../../src/infrastructure/agent-run/pg-interjection-store';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {TOOL_PERMISSION_GRANT_STORE} from '../../src/application/agent-run/tool-permission-grants';
import {ToolExecutionAuthority,TOOL_EXECUTION_AUTHORITY} from '../../src/application/agent-run/tool-execution-authority';
import {PgNativeRunInputs} from '../../src/infrastructure/agent-run/pg-native-run-inputs';
import {NativeFileDelegationProof} from '../../src/infrastructure/agent-run/native-file-delegation-proof';
import {NativeFileDelegationController} from '../../src/interface/controllers/native-file-delegation.controller';
import {NATIVE_FILE_DELEGATION} from '../../src/application/agent-run/native-file-delegation';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {resolveObjectPath} from '../../src/infrastructure/storage/object-store-path';
import {DATABASE_PORT} from '../../src/application/ports/database.port';
import {OBJECT_STORE} from '../../src/application/artifact/ports';
import {IDENTITY_REPOSITORY,DECISION_ID_FACTORY} from '../../src/application/identity/ports';
import {CHAT_REPOSITORY} from '../../src/application/chat/ports';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('file-delegation-'+randomUUID()),parent='run-'+randomUUID();let db:PgDatabase;
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

const scopes:string[]=[];
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();await resetOrgs(scopes);});
async function verifyDelegatedInputs(includeRuntime:boolean){
 const org=toOrgId('file-proof-'+randomUUID()),parent='run-'+randomUUID();scopes.push(org);await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
 const root=await mkdtemp(join(tmpdir(),'delegated-input-')),objects=new FsObjectStore(root),content=Buffer.from('actual delegated source'),attachmentId='a-'+randomUUID();
 const visibility={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)};
 const inputs=new PgNativeRunInputs(db,objects,visibility);
 const runs=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db);
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),runs,grants);
 const {KernelModule}=await import('../../src/kernel.module');
 const binding=(Reflect.getMetadata('providers',KernelModule) as FactoryProvider[]).find(p=>p.provide===NATIVE_FILE_DELEGATION)!;
 expect(binding.inject).toEqual([DATABASE_PORT,TOOL_EXECUTION_AUTHORITY,OBJECT_STORE,IDENTITY_REPOSITORY,DECISION_ID_FACTORY,CHAT_REPOSITORY]);
 expect(Reflect.getMetadata('controllers',KernelModule)).toContain(NativeFileDelegationController);
 const service=binding.useFactory(db,authority,objects,visibility.repo,visibility.ids,visibility.chat) as NativeFileDelegationProof;
 expect(service).toBeInstanceOf(NativeFileDelegationProof);
 class Fixture{};Module({controllers:[NativeFileDelegationController,RunInterjectionController],providers:[{provide:NATIVE_FILE_DELEGATION,useValue:service},{provide:AGENT_RUN_STORE,useValue:runs},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority}]})(Fixture);
 const app=await NestFactory.create(Fixture,{logger:false});const prior=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='delegation-test';
 try{
  await objects.putOnce('input.txt',content,'text/plain');
  await asApp(org,c=>c.query(`INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes) VALUES($1,$2,$3,$4,'input.txt','input.txt','text/plain',$5)`,[attachmentId,org,'thread-'+org,'message-'+org,content.length]));
  const context={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1},file=(await inputs.read(context)).manifest[0]!;
  const body={orgId:org,attemptId:context.attemptId,leaseEpoch:1,toolCallId:'child-read-call',toolName:'read_file' as const,toolArgs:{file_path:file.path},file};
  await app.listen(0,'127.0.0.1');const url=`${await app.getUrl()}/internal/agent-runs/${parent}/delegation/files/check`;
  const post=(value:unknown=body,key='delegation-test')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify(value)});
  expect((await post(body,'wrong')).status).toBe(401);expect(await (await post()).json()).toEqual({allowed:true});
  if(includeRuntime){
   if(!process.env.WX_NATIVE_SANDBOX_CONTAINER)throw new Error('Owned sandbox container required');
   await grants.grantForRun(org,parent,'task');
   const set=await inputs.read(context),cwd=join(process.cwd(),'../deep-agent-service');
   const config={configurable:{run_control_callback:{base_url:await app.getUrl(),key:'delegation-test',org_id:org,run_id:parent,attempt_id:context.attemptId,lease_epoch:1}}};
   const result=await new Promise<string>((resolve,reject)=>{
    const child=spawn(join(cwd,'.venv/bin/python'),['tests/native_file_delegation_runner.py'],{cwd,timeout:45000,killSignal:'SIGTERM'});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr)));child.stdin.end(JSON.stringify({config,manifest:set.manifest,files:set.files,expectedText:content.toString()}));
   });
   expect(JSON.parse(result)).toEqual({completedDelegations:2,actualSourceObserved:true,readonlyInput:true,externalModelCalls:0});
   expect(result).not.toContain('delegation-test');
   console.info('T010_REAL_CHAIN',result.trim());
  }
  for(const changed of [{orgId:'other-org'},{attemptId:'old'},{leaseEpoch:2},{toolArgs:{file_path:'/workspace/secret'}},{file:{...file,digest:'0'.repeat(64)}}])expect((await post({...body,...changed})).status).toBe(503);
  await writeFile(resolveObjectPath(root,'input.txt'),Buffer.alloc(content.length,120));expect((await post()).status).toBe(503);await writeFile(resolveObjectPath(root,'input.txt'),content);
  await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,'thread-'+org,'intruder']));expect((await post()).status).toBe(503);
  await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,'thread-'+org,'actor']));expect((await post()).status).toBe(200);
  await asApp(org,c=>c.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[org,parent]));expect((await post()).status).toBe(503);
 }finally{if(prior===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=prior;await app.close();await rm(root,{recursive:true,force:true});}
 }
it('current input proof rejects cross-scope paths, byte changes, source revocation and parent cancellation over HTTP',()=>verifyDelegatedInputs(false),60000);
it.skipIf(!process.env.WX_NATIVE_SANDBOX_CONTAINER)('official task delegates twice through actual sandbox and current PG/HTTP authority',()=>verifyDelegatedInputs(true),60000);
