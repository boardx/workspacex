import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {ScheduleNotificationListOutput} from '@repo/contracts/schedule-notifications';
import {Module,type FactoryProvider,type ExistingProvider} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Request,Response,NextFunction} from 'express';
import {it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgChatMessageCommandRepository,PgPublishedAgentReader} from '../../src/infrastructure/chat/pg-chat-message-command-repository';
import {PgThreadMountedSkillReader} from '../../src/infrastructure/chat/pg-thread-mounted-skill-reader';
import {PgEnabledSkillVersionReader} from '../../src/infrastructure/skill/pg-enabled-skill-version-reader';
import {ScheduledChatRunGateway} from '../../src/infrastructure/agent-run/scheduled-chat-run-gateway';
import {PgBossScheduler} from '../../src/infrastructure/agent-run/pg-boss-scheduler';
import {setupPgBossScheduler} from '../../src/infrastructure/agent-run/setup-pg-boss-scheduler';
import {PgStandardSchedule} from '../../src/infrastructure/agent-run/pg-standard-schedule';
import {PgScheduleNotifications} from '../../src/infrastructure/agent-run/pg-schedule-notifications';
import {ScheduleNotificationsController} from '../../src/interface/controllers/schedule-notifications.controller';
import {DATABASE_PORT} from '../../src/application/ports/database.port';
import {IDENTITY_REPOSITORY} from '../../src/application/identity/ports';
import {SCHEDULED_RUN_NOTIFIER} from '../../src/application/agent-run/standard-schedule';
import {SCHEDULE_NOTIFICATIONS} from '../../src/application/agent-run/schedule-notifications';
import {toOrgId} from '../../src/domain/org-id';
import type {Principal} from '../../src/domain/principal';
it('official due job uses the real chat rejection path then persists a visible HTTP notice and server read receipt',async()=>{
 ensureDatabase();await migrateOnce();await setupPgBossScheduler(migrationConfig());
 const org=toOrgId('notice-delivery-'+randomUUID()),id=randomUUID(),db=new PgDatabase(appConfig());
 const identity=new PgIdentityRepository(db),provider=new PgBossScheduler(db,()=>{});
 let kicks=0,modelCalls=0;
 const visibility={chat:new PgChatRepository(db),repo:identity,ids:{next:()=>randomUUID()},runs:new PgAgentRunRepository(db)};
 const gateway=new ScheduledChatRunGateway({...visibility,commands:new PgChatMessageCommandRepository(db),publishedAgents:new PgPublishedAgentReader(db),threadMounts:new PgThreadMountedSkillReader(db),enabledSkills:new PgEnabledSkillVersionReader(db),model:{complete:async()=>{modelCalls++;throw new Error('unexpected model');}},titleModel:{provider:'unused',modelId:'unused'},log:()=>{}},()=>{kicks++;});
 const {KernelModule}=await import('../../src/kernel.module');
 const bindings=Reflect.getMetadata('providers',KernelModule) as Array<FactoryProvider|ExistingProvider>;
 const selected=[PgScheduleNotifications,SCHEDULE_NOTIFICATIONS,SCHEDULED_RUN_NOTIFIER].map(token=>{const binding=bindings.find(p=>p.provide===token);expect(binding).toBeDefined();return binding!;});
 expect(Reflect.getMetadata('controllers',KernelModule)).toContain(ScheduleNotificationsController);
 class Fixture{};Module({controllers:[ScheduleNotificationsController],providers:[...selected,{provide:DATABASE_PORT,useValue:db},{provide:IDENTITY_REPOSITORY,useValue:identity}]})(Fixture);
 const app=await NestFactory.create(Fixture,{logger:false});
 const notifier=app.get<PgScheduleNotifications>(SCHEDULE_NOTIFICATIONS);
 expect(app.get(SCHEDULED_RUN_NOTIFIER)).toBe(notifier);expect(app.get(PgScheduleNotifications)).toBe(notifier);
 const service=new PgStandardSchedule({db,provider,gateway,notifier,visibility,authority:{check:async()=>{throw new Error('tool invocation not used by durable delivery');}}});
 app.use((req:Request&{principal?:Principal},_res:Response,next:NextFunction)=>{req.principal={orgId:org,userId:'actor'};next();});
 try{
  await seedOrg({orgId:org,projectId:'project-'+org});await addOrgMember(org,'actor','consultant',null);
  await addChatThread({orgId:org,id:'thread-'+org,projectId:null,visibilityScope:'private',createdBy:'actor',archived:true});
  await asApp(org,c=>c.query(`INSERT INTO standard_schedules(id,org_id,user_id,thread_id,agent_id,instruction,idempotency_key,args_digest)
    VALUES($1,$2,'actor',$3,'unused-agent','SECRET ARCHIVED TASK',$4,'digest')`,[id,org,'thread-'+org,randomUUID()]));
  await app.listen(0,'127.0.0.1');await provider.start(job=>service.deliver(job));
  await db.withTenant(org,s=>provider.inTransaction(s,()=>provider.create(id,org,{trigger:'once',at:new Date(Date.now()+500).toISOString()})));
  const url=await app.getUrl(),deadline=Date.now()+10000;
  let notices:{notifications:Array<{factId:string;code:string}>}={notifications:[]};
  while(Date.now()<deadline){
   const response=await fetch(url+'/schedule-notifications');expect(response.status).toBe(200);notices=ScheduleNotificationListOutput.parse(await response.json());
   if(notices.notifications.length)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(notices.notifications).toHaveLength(1);expect(notices.notifications[0]).toMatchObject({factId:id,code:'authorization_revoked'});
  expect(JSON.stringify(notices)).not.toContain('SECRET');expect(kicks).toBe(0);expect(modelCalls).toBe(0);
  const row=await asApp(org,async c=>(await c.query('SELECT status,notification_pending,notification_accepted_at FROM standard_schedules WHERE org_id=$1 AND id=$2',[org,id])).rows[0]);
  expect(row.status).toBe('failed');expect(row.notification_pending).toBe(false);expect(row.notification_accepted_at).not.toBeNull();
  const response=await fetch(url+'/schedule-notifications/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({factId:id})});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({read:true});
  const restarted=new PgScheduleNotifications(db,new PgIdentityRepository(db));expect(await restarted.list({orgId:org,userId:'actor'},{})).toEqual({notifications:[]});
  expect(await asApp(org,async c=>(await c.query('SELECT count(*)::int n FROM chat_messages WHERE org_id=$1',[org])).rows[0].n)).toBe(0);
 }finally{await provider.stop();await app.close();await db.close();await resetOrgs(org);}
},30000);
