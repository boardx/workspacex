import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgStandardMemoryProof} from '../../src/infrastructure/agent-run/pg-standard-memory-proof';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {StandardMemoryProofController} from '../../src/interface/controllers/standard-memory-proof.controller';
import {STANDARD_MEMORY_PROOF} from '../../src/application/agent-run/standard-memory-proof';
const org=toOrgId('memory-'+randomUUID()),parent='run-'+randomUUID();let db:PgDatabase;
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

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);});
it('production kernel exposes the real memory proof provider and controller',async()=>{
 const {createApp}=await import('../../src/main');
 const app=await createApp();
 try{
  expect(app.get(STANDARD_MEMORY_PROOF)).toBeInstanceOf(PgStandardMemoryProof);
  expect(app.get(StandardMemoryProofController)).toBeInstanceOf(StandardMemoryProofController);
 }finally{await app.close();}
});
it('real HTTP proof binds requester and live source visibility, denies missing authority and changed lease',async()=>{
 let granted=false;
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),{readPinnedSkills:async()=>[]},{hasGrant:async()=>granted,grantForRun:async()=>{},grantStanding:async()=>{},revokeAllForRun:async()=>{}});
 const proof=new PgStandardMemoryProof(db,authority,{chat:new PgChatRepository(db),repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()}});
 class TestModule{};Module({controllers:[StandardMemoryProofController],providers:[{provide:STANDARD_MEMORY_PROOF,useValue:proof}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
 const previous=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='memory-test-key';
 const args={text:'remember explicitly',sourceMessageId:`message-${org}`,idempotencyKey:'one'};
 const body={orgId:org,userId:'actor',attemptId:parent+':0',leaseEpoch:1,toolCallId:'real-call',toolName:'wx_memory_write' as const,toolArgs:args,sources:[]};
 try {
  const url=`${await app.getUrl()}/internal/agent-runs/${parent}/memory/source-proof`;
  async function request(value:unknown,key='memory-test-key'){return fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify(value)});}
  expect((await request(body,'wrong')).status).toBe(401);
  expect((await request({...body,toolName:'wx_memory_search',toolArgs:{}})).status).toBe(200);
  expect((await request(body)).status).toBe(503);
  expect((await request({...body,toolName:'wx_memory_delete',toolArgs:{memoryId:randomUUID(),expectedRevision:1}})).status).toBe(503);
  granted=true;
  await proof.check(parent,body);
  const good=await request(body);expect(good.status).toBe(200);expect(await good.json()).toMatchObject({scope:{orgId:org,userId:'actor'},sourceRef:{messageId:args.sourceMessageId}});
  for(const changed of [{userId:'intruder'},{orgId:'other'},{leaseEpoch:2},{toolArgs:{...args,sourceMessageId:'forged'}}])expect((await request({...body,...changed})).status).toBe(503);
  const source={threadId:`thread-${org}`,messageId:args.sourceMessageId};
  const search={...body,toolName:'wx_memory_search',toolArgs:{},sources:[source]};
  expect(await (await request(search)).json()).toMatchObject({visible:[source]});
  const pg=migrationConfig(),cwd=join(process.cwd(),'../deep-agent-service');
  const dsn=`postgresql://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.database}`;
  const env={...process.env,MEMORY_STORE_DATABASE_URL:dsn,MEMORY_STORE_MIGRATION_DATABASE_URL:dsn,MEMORY_STORE_SCHEMA:'memory_chain_'+randomUUID().replaceAll('-','')};
  const config={configurable:{wsx_memory_scope:{orgId:org,userId:'actor'},run_control_callback:{base_url:await app.getUrl(),key:'memory-test-key',org_id:org,run_id:parent,attempt_id:body.attemptId,lease_epoch:1}}};
  const tool=(name:string,args:unknown,setup=false,async=false)=>new Promise<Record<string,unknown>>((resolve,reject)=>{
   const child=spawn(join(cwd,'.venv/bin/python'),['tests/standard_memory_runner.py'],{cwd,env});let stdout='',stderr='';
   child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);
   child.on('exit',code=>code===0?resolve(JSON.parse(stdout) as Record<string,unknown>):reject(new Error(stderr)));
   child.stdin.end(JSON.stringify({config,name,args,setup,async}));
  });
  const receipt=await tool('wx_memory_write',args,true);
  expect(receipt).toMatchObject({revision:1});
  expect(await tool('wx_memory_write',args,false,true)).toEqual(receipt);
  expect(await tool('wx_memory_search',{})).toMatchObject({mode:'literal',items:[{text:args.text}]});
  const nextThread='next-'+randomUUID(),nextRun='next-'+randomUUID(),nextMessage='next-'+randomUUID();
  await addChatThread({orgId:org,id:nextThread,projectId:null,visibilityScope:'private',createdBy:'actor'});
  await addChatMessage({orgId:org,id:nextMessage,threadId:nextThread,body:'recall my preferences',authorId:'actor'});
  await asApp(org,c=>c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at)
   SELECT $1,org_id,$2,$3,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,'running',now(),1,now()+interval '10 minutes' FROM agent_runs WHERE org_id=$4 AND id=$5`,[nextRun,nextThread,nextMessage,org,parent]));
  await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,nextRun]));
  config.configurable.run_control_callback.run_id=nextRun;config.configurable.run_control_callback.attempt_id=nextRun+':0';
  expect(await tool('wx_memory_search',{},false,true)).toMatchObject({items:[{text:args.text}]});
  await asApp(org,c=>c.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,'actor']));
  await expect(tool('wx_memory_search',{})).rejects.toThrow('Memory unavailable or refused');
  await addOrgMember(org,'actor','consultant',null);
  await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$1 WHERE org_id=$2 AND id=$3',['intruder',org,source.threadId]));
  expect((await request(search)).status).toBe(503);
  expect(await tool('wx_memory_search',{},false,true)).toMatchObject({items:[]});
  expect(await tool('wx_memory_delete',{memoryId:receipt.memoryId,expectedRevision:1})).toEqual({deleted:true});
 }finally{await app.close();if(previous===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=previous;}
});

it('official Python PostgresStore proves rollback, concurrent CAS, replay and tombstones',async()=>{
 const config=migrationConfig();
 const dsn=`postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
 const cwd=join(process.cwd(),'../deep-agent-service');
 const output=await new Promise<string>((resolve,reject)=>{
  const child=spawn(join(cwd,'.venv/bin/python'),['-m','pytest','tests/test_standard_memory.py','-q'],{cwd,env:{...process.env,WX_MEMORY_TEST_DSN:dsn}});
  let result='';child.stdout.on('data',chunk=>result+=chunk);child.stderr.on('data',chunk=>result+=chunk);
  child.on('error',reject);child.on('exit',code=>code===0?resolve(result):reject(new Error(result)));
 });
 expect(output).toContain('7 passed');
},90000);
