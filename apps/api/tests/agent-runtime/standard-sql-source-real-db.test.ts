import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {enableIsolatedSqlTls} from '../support/standard-sql-tls';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgStandardSqlSource} from '../../src/infrastructure/agent-run/pg-standard-sql-source';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {StandardSqlSourceController} from '../../src/interface/controllers/standard-sql-source.controller';
import {STANDARD_SQL_SOURCE} from '../../src/application/agent-run/standard-sql-source';
const org=toOrgId('sql-'+randomUUID()),parent='run-'+randomUUID();let db:PgDatabase;
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

beforeAll(async()=>{ensureDatabase();await migrateOnce();await enableIsolatedSqlTls();db=new PgDatabase(appConfig());await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);});
it('production SQL source provider and controller are registered',async()=>{
 const {createApp}=await import('../../src/main');const app=await createApp();
 try{expect(app.get(STANDARD_SQL_SOURCE)).toBeInstanceOf(PgStandardSqlSource);expect(app.get(StandardSqlSourceController)).toBeInstanceOf(StandardSqlSourceController);}finally{await app.close();}
});
it('real Python native tools cross HTTP source authority into a separate TLS read-only database',async()=>{
 let grant=false;
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),{readPinnedSkills:async()=>[]},{hasGrant:async()=>grant,grantForRun:async()=>{},grantStanding:async()=>{},revokeAllForRun:async()=>{}});
 const source=new PgStandardSqlSource(db,authority,{chat:new PgChatRepository(db),repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()}});
 class TestModule{};Module({controllers:[StandardSqlSourceController],providers:[{provide:STANDARD_SQL_SOURCE,useValue:source}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,oldBindings=process.env.STANDARD_SQL_BINDINGS;
 process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='sql-internal-key';process.env.STANDARD_SQL_BINDINGS=JSON.stringify([{orgId:org,userIds:['actor'],dataSourceId:'readonly'}]);
 const body={orgId:org,userId:'actor',attemptId:parent+':0',leaseEpoch:1,toolCallId:'actual',toolName:'sql_db_list_tables',toolArgs:{}};
 try{
  const base=await app.getUrl(),url=`${base}/internal/agent-runs/${parent}/sql/source/check`;
  const post=(value:unknown,key='sql-internal-key')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify(value)});
  expect((await post(body,'wrong')).status).toBe(401);expect((await post(body)).status).toBe(503);grant=true;
  expect(await (await post(body)).json()).toEqual({dataSourceId:'readonly'});
  for(const change of [{orgId:'other'},{userId:'intruder'},{leaseEpoch:2},{toolArgs:{dsn:'postgresql://fake'}},{toolName:'unknown'}])expect((await post({...body,...change})).status).not.toBe(200);
  const config={configurable:{wsx_memory_scope:{orgId:org,userId:'actor'},run_control_callback:{base_url:base,key:'sql-internal-key',org_id:org,run_id:parent,attempt_id:body.attemptId,lease_epoch:1}}};
  const pg=migrationConfig(),cwd=join(process.cwd(),'../deep-agent-service');
  const output=await new Promise<string>((resolve,reject)=>{
   const child=spawn(join(cwd,'.venv/bin/python'),['tests/standard_sql_runner.py'],{cwd,env:{...process.env,WX_SQL_TEST_DSN:`postgresql://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.database}`}});let stdout='',stderr='';
   child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);
   child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr)));child.stdin.end(JSON.stringify(config));
  });
  expect(JSON.parse(output)).toMatchObject({tables:'allowed',checked:'SELECT count(*) FROM allowed',query:{rows:[{count:2}],truncated:false,rowCount:1}});
  expect(output).not.toContain('sql-test');expect(output).not.toContain('postgresql');expect(output).not.toContain('sql-internal-key');
  await asApp(org,c=>c.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,'actor']));
  expect((await post(body)).status).toBe(503);
 }finally{
  await app.close();if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;
  if(oldBindings===undefined)delete process.env.STANDARD_SQL_BINDINGS;else process.env.STANDARD_SQL_BINDINGS=oldBindings;
 }
},90000);
