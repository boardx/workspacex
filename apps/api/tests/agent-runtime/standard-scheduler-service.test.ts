import 'reflect-metadata';
import {KernelModule} from '../../src/kernel.module';
import {StandardScheduleRuntime} from '../../src/infrastructure/agent-run/standard-schedule-runtime';
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
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgChatMessageCommandRepository,PgPublishedAgentReader} from '../../src/infrastructure/chat/pg-chat-message-command-repository';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgThreadMountedSkillReader} from '../../src/infrastructure/chat/pg-thread-mounted-skill-reader';
import {PgEnabledSkillVersionReader} from '../../src/infrastructure/skill/pg-enabled-skill-version-reader';
import {PgBossScheduler,SCHEDULE_QUEUE} from '../../src/infrastructure/agent-run/pg-boss-scheduler';
import {setupPgBossScheduler} from '../../src/infrastructure/agent-run/setup-pg-boss-scheduler';
import {PgStandardSchedule} from '../../src/infrastructure/agent-run/pg-standard-schedule';
import {ScheduledChatRunGateway} from '../../src/infrastructure/agent-run/scheduled-chat-run-gateway';
import {StandardScheduleController} from '../../src/interface/controllers/standard-schedule.controller';
import {STANDARD_SCHEDULE} from '../../src/application/agent-run/standard-schedule';
import type {ScheduleView,ScheduledRunNotifier} from '../../src/application/agent-run/standard-schedule';
const org=toOrgId('schedule-'+randomUUID()),parent='run-'+randomUUID();let db:PgDatabase;
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
    await c.query('UPDATE agents SET published_version_id=$1 WHERE org_id=$2 AND id=$3',[version,scope,agent]);
  });
}

beforeAll(async()=>{ensureDatabase();await migrateOnce();await setupPgBossScheduler(migrationConfig());db=new PgDatabase(appConfig());await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);});
function components(){
 let grant=true;const notifications:unknown[]=[],kicks:string[]=[],errors:string[]=[];
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),{readPinnedSkills:async()=>[]},{hasGrant:async()=>grant,grantForRun:async()=>{},grantStanding:async()=>{},revokeAllForRun:async()=>{}});
 const visibility={chat:new PgChatRepository(db),repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},runs:new PgAgentRunRepository(db)};
 const commands=new PgChatMessageCommandRepository(db);
 const gateway=new ScheduledChatRunGateway({...visibility,commands,publishedAgents:new PgPublishedAgentReader(db),threadMounts:new PgThreadMountedSkillReader(db),enabledSkills:new PgEnabledSkillVersionReader(db),model:{complete:async()=>({text:'Scheduled task'})},titleModel:{provider:'fake',modelId:'fake'},log:()=>{}},orgId=>kicks.push(orgId));
 const provider=new PgBossScheduler(db,code=>errors.push(code));
 const notifier:ScheduledRunNotifier={publish:async fact=>{notifications.push(fact);return {durablyAccepted:true};}};
 const service=new PgStandardSchedule({db,authority,visibility,provider,gateway,notifier});
 return {service,provider,gateway,commands,notifier,notifications,kicks,errors,authority,visibility,setGrant:(value:boolean)=>{grant=value;}};
}
const request=(name:'wx_schedule_create'|'wx_schedule_list'|'wx_schedule_cancel',args:Record<string,unknown>)=>({orgId:org,userId:'actor',attemptId:parent+':0',leaseEpoch:1,toolCallId:randomUUID(),toolName:name,toolArgs:args});
const createArgs=()=>({instruction:'Scheduled real gateway message',timezone:'UTC',trigger:'once',scheduleSpec:{at:new Date(Date.now()+60000).toISOString()},idempotencyKey:randomUUID()});
it('real HTTP creation/list/cancel reuses current authority and rejects changed identity',async()=>{
 const c=components();await c.provider.start(job=>c.service.deliver(job));
 class TestModule{};Module({controllers:[StandardScheduleController],providers:[{provide:STANDARD_SCHEDULE,useValue:c.service}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const old=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='schedule-test';
 try{
  const url=`${await app.getUrl()}/internal/agent-runs/${parent}/schedule/tools/invoke`;
  const post=(body:unknown,key='schedule-test')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},body:JSON.stringify(body)});
  const args=createArgs(),body=request('wx_schedule_create',args);
  expect((await post(body,'bad')).status).toBe(401);c.setGrant(false);expect((await post(body)).status).toBe(503);c.setGrant(true);
  const response=await post(body);expect(response.status).toBe(200);const first=await response.json() as ScheduleView;
  expect(await (await post(body)).json()).toEqual(first);
  for(const change of [{userId:'intruder'},{orgId:'other'},{leaseEpoch:2},{toolArgs:{...args,orgId:'other'}},{toolArgs:{...args,instruction:'changed'}}])expect((await post({...body,...change})).status).not.toBe(200);
  const list=await (await post(request('wx_schedule_list',{}))).json() as {schedules:ScheduleView[]};expect(list.schedules.some(item=>item.scheduleId===first.scheduleId)).toBe(true);
  const otherParent='other-'+randomUUID(),otherThread='other-thread-'+randomUUID(),otherMessage='other-message-'+randomUUID();
  await addChatThread({orgId:org,id:otherThread,projectId:null,visibilityScope:'private',createdBy:'intruder'});
  await addChatMessage({orgId:org,id:otherMessage,threadId:otherThread,body:'other own run',authorId:'intruder'});
  await asApp(org,async s=>{
   await s.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) SELECT $1,org_id,$2,$3,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,'running',now(),1,now()+interval '10 minutes' FROM agent_runs WHERE org_id=$4 AND id=$5`,[otherParent,otherThread,otherMessage,org,parent]);
   await s.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,otherParent]);
  });
  const otherBody={...request('wx_schedule_list',{}),userId:'intruder',attemptId:otherParent+':0'};
  const otherResponse=await fetch(url.replace(parent,otherParent),{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'schedule-test'},body:JSON.stringify(otherBody)});
  expect(otherResponse.status).toBe(200);expect(await otherResponse.json()).toEqual({schedules:[]});

  expect(await (await post(request('wx_schedule_cancel',{scheduleId:first.scheduleId,expectedRevision:1}))).json()).toEqual({cancelled:true});
  expect(await (await post(request('wx_schedule_cancel',{scheduleId:first.scheduleId,expectedRevision:1}))).json()).toEqual({cancelled:true});
  expect((await c.provider.boss.getJobById(SCHEDULE_QUEUE,first.scheduleId))?.state).toBe('cancelled');
  const config={configurable:{wsx_memory_scope:{orgId:org,userId:'actor'},run_control_callback:{base_url:await app.getUrl(),key:'schedule-test',org_id:org,run_id:parent,attempt_id:parent+':0',lease_epoch:1}}};
  const cwd=join(process.cwd(),'../deep-agent-service');
  const output=await new Promise<string>((resolve,reject)=>{
   const child=spawn(join(cwd,'.venv/bin/python'),['tests/standard_schedule_runner.py'],{cwd});let stdout='',stderr='';
   child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr)));child.stdin.end(JSON.stringify(config));
  });
  expect(JSON.parse(output).cancelled).toEqual({cancelled:true});expect(output).not.toContain('schedule-test');

 }finally{process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=old;await app.close();await c.provider.stop();}
},60000);

const waitUntil=async(fn:()=>Promise<boolean>)=>{const end=Date.now()+12000;while(!await fn()){if(Date.now()>end)throw new Error('delivery deadline');await new Promise(r=>setTimeout(r,25));}};
it('actual Chat command uses the schedule lock connection and outer rollback leaves no run',async()=>{
 const c=components();await c.provider.start(job=>c.service.deliver(job));
 const schedule=await c.service.invoke(parent,request('wx_schedule_create',createArgs())) as ScheduleView;
 const original=c.commands.accept.bind(c.commands);let outerPid=0,innerPid=0;
 c.commands.accept=async(orgId,input)=>db.withTenant(orgId,async s=>{innerPid=(await s.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;return original(orgId,input);});
 try{
  await expect(db.withTenant(org,async s=>{
   await s.query('SELECT id FROM standard_schedules WHERE org_id=$1 AND id=$2::uuid FOR UPDATE',[org,schedule.scheduleId]);
   outerPid=(await s.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
   await c.gateway.dispatch({orgId:org,userId:'actor',threadId:`thread-${org}`,agentId:`agent-${org}`,instruction:'must roll back',occurrenceId:schedule.scheduleId});
   throw new Error('rollback accepted message');
  })).rejects.toThrow('rollback accepted message');
  expect(innerPid).toBe(outerPid);expect(innerPid).toBeGreaterThan(0);
  expect(await asApp(org,async s=>(await s.query('SELECT id FROM chat_messages WHERE org_id=$1 AND client_message_id=$2::uuid',[org,schedule.scheduleId])).rowCount)).toBe(0);
  await c.service.invoke(parent,request('wx_schedule_cancel',{scheduleId:schedule.scheduleId}));
 }finally{await c.provider.stop();}
},60000);
it('cancel linearizes before a new run or waits for an already accepted occurrence',async()=>{
 const c=components();let entered!:()=>void,release!:()=>void;
 const blocked=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const original=c.gateway.dispatch.bind(c.gateway);
 c.gateway.dispatch=async input=>{entered();await gate;return original(input);};
 await c.provider.start(job=>c.service.deliver(job));
 try{
  const cancelled=await c.service.invoke(parent,request('wx_schedule_create',createArgs())) as ScheduleView;
  await c.service.invoke(parent,request('wx_schedule_cancel',{scheduleId:cancelled.scheduleId}));
  expect(await asApp(org,async s=>(await s.query('SELECT id FROM chat_messages WHERE org_id=$1 AND client_message_id=$2::uuid',[org,cancelled.scheduleId])).rowCount)).toBe(0);
  const due={...createArgs(),scheduleSpec:{at:new Date(Date.now()+1000).toISOString()}};
  const created=await c.service.invoke(parent,request('wx_schedule_create',due)) as ScheduleView;
  await Promise.race([blocked,new Promise((_,reject)=>setTimeout(()=>reject(new Error('no due delivery')),10000))]);
  let settled=false;const cancellation=c.service.invoke(parent,request('wx_schedule_cancel',{scheduleId:created.scheduleId})).then(result=>{settled=true;return result;});
  await new Promise(r=>setTimeout(r,50));expect(settled).toBe(false);release();
  expect(await cancellation).toEqual({cancelled:false});
  await waitUntil(async()=>c.kicks.length>0);
  const accepted=await asApp(org,async s=>(await s.query('SELECT id FROM chat_messages WHERE org_id=$1 AND client_message_id=$2::uuid',[org,created.scheduleId])).rowCount);
  expect(accepted).toBe(1);
  // Lost acknowledgment: re-delivering the exact persisted occurrence only kicks
  // the existing run, even when the schedule is already completed.
  const job=await c.provider.boss.getJobById<{orgId:string;scheduleId:string}>(SCHEDULE_QUEUE,created.scheduleId);expect(job).not.toBeNull();
  await c.service.deliver({...job!,signal:new AbortController().signal});
  expect(await asApp(org,async s=>(await s.query('SELECT id FROM chat_messages WHERE org_id=$1 AND client_message_id=$2::uuid',[org,created.scheduleId])).rowCount)).toBe(1);
 }finally{release();await c.provider.stop();}
},60000);
it('revocation prevents the next actual due run and submits only a peer reminder fact',async()=>{
 const c=components();let notificationAttempts=0;const acceptedFacts=new Map<string,unknown>();
 c.notifier.publish=async fact=>{notificationAttempts++;acceptedFacts.set(fact.factId,fact);if(notificationAttempts===1)throw new Error('lost peer acknowledgment');c.notifications.push(fact);return {durablyAccepted:true};};
 await c.provider.start(job=>c.service.deliver(job));
 try{
  const created=await c.service.invoke(parent,request('wx_schedule_create',{...createArgs(),scheduleSpec:{at:new Date(Date.now()+1000).toISOString()}})) as ScheduleView;
  await asApp(org,s=>s.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,'actor']));
  await waitUntil(async()=>c.notifications.length===1&&(await asApp(org,s=>s.query('SELECT notification_pending FROM standard_schedules WHERE org_id=$1 AND id=$2::uuid',[org,created.scheduleId]))).rows[0]?.notification_pending===false);
  expect(notificationAttempts).toBe(2);expect(acceptedFacts.size).toBe(1);
  expect(c.notifications[0]).toEqual({factId:created.scheduleId,orgId:org,userId:'actor',scheduleId:created.scheduleId,code:'authorization_revoked'});
  expect(await asApp(org,async s=>(await s.query('SELECT id FROM chat_messages WHERE org_id=$1 AND client_message_id=$2::uuid',[org,created.scheduleId])).rowCount)).toBe(0);
  expect((await asApp(org,s=>s.query('SELECT status,notification_pending FROM standard_schedules WHERE org_id=$1 AND id=$2::uuid',[org,created.scheduleId]))).rows[0]).toEqual({status:'failed',notification_pending:false});
 }finally{await addOrgMember(org,'actor','consultant',null);await c.provider.stop();}
},60000);

it('production kernel factory starts real SDK through Nest and missing notifier refuses creation',async()=>{
 const bindings=Reflect.getMetadata('providers',KernelModule) as Array<{provide?:symbol;useFactory?:(...args:unknown[])=>InstanceType<typeof StandardScheduleRuntime>}>;
 const binding=bindings.find(p=>p.provide===STANDARD_SCHEDULE)!;
 const c=components();
 const prior=process.env.KERNEL_STANDARD_SCHEDULER;process.env.KERNEL_STANDARD_SCHEDULER='1';
 let runtime:InstanceType<typeof StandardScheduleRuntime>;
 try{runtime=binding.useFactory!(db,c.authority,c.visibility.repo,c.visibility.ids,c.visibility.chat,c.visibility.runs,
  c.commands,new PgPublishedAgentReader(db),new PgThreadMountedSkillReader(db),new PgEnabledSkillVersionReader(db),
  {kick:(id:typeof org)=>c.kicks.push(id)},{complete:async()=>({text:'Scheduled'})},{provider:'fake',modelId:'fake'},{error:()=>{}});
 }finally{if(prior===undefined)delete process.env.KERNEL_STANDARD_SCHEDULER;else process.env.KERNEL_STANDARD_SCHEDULER=prior;}
 class ProductionProviderTest{};Module({providers:[{provide:STANDARD_SCHEDULE,useValue:runtime!}]})(ProductionProviderTest);
 const app=await NestFactory.createApplicationContext(ProductionProviderTest,{logger:false});
 try{
  await expect(runtime!.invoke(parent,request('wx_schedule_create',createArgs()))).rejects.toThrow('schedule_notifier_unavailable');
  expect(await runtime!.invoke(parent,request('wx_schedule_list',{}))).toHaveProperty('schedules');
 }finally{await app.close();}
});

it('parent cancellation wins before the shared authority lock and leaves no schedule or SDK job',async()=>{
 const c=components();await c.provider.start(job=>c.service.deliver(job));
 let unlock!:()=>void,locked!:()=>void,authorityEntered!:()=>void;
 const held=new Promise<void>(r=>{locked=r;}),gate=new Promise<void>(r=>{unlock=r;});
 const checking=new Promise<void>(r=>{authorityEntered=r;});
 let authorityPid=0,sdkPid=0;
 const check=c.authority.check.bind(c.authority),create=c.provider.create.bind(c.provider);
 c.authority.check=input=>db.withTenant(org,async s=>{authorityPid=(await s.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;authorityEntered();return check(input);});
 c.provider.create=async(...args)=>{sdkPid=await db.withTenant(org,async s=>(await s.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);return create(...args);};
 const jobs=()=>db.withoutTenant(async s=>(await s.query<{id:string}>("SELECT id FROM workspacex_scheduler.job WHERE name=$1 AND data->>'orgId'=$2 ORDER BY id",[SCHEDULE_QUEUE,org])).rows.map(row=>row.id));
 const before=await jobs(),args=createArgs();
 const cancellation=asApp(org,async s=>{
  await s.query('SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[org,parent]);
  await s.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[org,parent]);
  locked();await gate;
 });
 try{
  await held;
  const pending=c.service.invoke(parent,request('wx_schedule_create',args));
  const refused=expect(pending).rejects.toThrow('standard_tool_authority_denied');
  await checking;
  await waitUntil(async()=>await asApp(org,async s=>(await s.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[authorityPid])).rows[0]!.blocked));
  unlock();await cancellation;await refused;
  expect(sdkPid).toBe(0);expect(await jobs()).toEqual(before);
  expect(await asApp(org,async s=>(await s.query('SELECT id FROM standard_schedules WHERE org_id=$1 AND idempotency_key=$2::uuid',[org,args.idempotencyKey])).rows)).toEqual([]);
  // A fresh allowed operation reaches SDK creation on the exact same backend
  // used by authority, proving the nested reader cannot commit/unlock early.
  await asApp(org,s=>s.query('UPDATE agent_runs SET cancel_requested_at=NULL WHERE org_id=$1 AND id=$2',[org,parent]));
  const accepted=await c.service.invoke(parent,request('wx_schedule_create',createArgs())) as ScheduleView;
  expect(sdkPid).toBeGreaterThan(0);expect(sdkPid).toBe(authorityPid);
  await c.service.invoke(parent,request('wx_schedule_cancel',{scheduleId:accepted.scheduleId}));
 }finally{
  unlock();await cancellation;
  await asApp(org,s=>s.query('UPDATE agent_runs SET cancel_requested_at=NULL WHERE org_id=$1 AND id=$2',[org,parent]));
  await c.provider.stop();
 }
},60000);
