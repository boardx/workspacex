import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Request,Response,NextFunction} from 'express';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgScheduleNotifications} from '../../src/infrastructure/agent-run/pg-schedule-notifications';
import {ScheduleNotificationsController} from '../../src/interface/controllers/schedule-notifications.controller';
import {SCHEDULE_NOTIFICATIONS,ScheduleNotificationForbiddenError,ScheduleNotificationNotFoundError} from '../../src/application/agent-run/schedule-notifications';
import {toOrgId} from '../../src/domain/org-id';
import type {Principal} from '../../src/domain/principal';
const org=toOrgId('notice-'+randomUUID()),other=toOrgId('notice-other-'+randomUUID());
let db:PgDatabase,service:PgScheduleNotifications;
const viewer={orgId:org,userId:'actor'};
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());service=new PgScheduleNotifications(db,new PgIdentityRepository(db));
 for(const scope of [org,other]){await seedOrg({orgId:scope,projectId:'project-'+scope});await addOrgMember(scope,'actor','consultant',null);await addOrgMember(scope,'intruder','consultant',null);await addChatThread({orgId:scope,id:'thread-'+scope,projectId:null,visibilityScope:'private',createdBy:'actor'});}
});
afterAll(async()=>{await db?.close();await resetOrgs(org,other);});
async function failed(){
 const scheduleId=randomUUID(),factId=randomUUID();
 await asApp(org,c=>c.query(`INSERT INTO standard_schedules(id,org_id,user_id,thread_id,agent_id,instruction,idempotency_key,args_digest,status,last_occurrence_id,failure_code,notification_pending)
 VALUES($1,$2,'actor',$3,'agent','PRIVATE INSTRUCTION',$4,'digest','failed',$5,'authorization_revoked',true)`,[scheduleId,org,'thread-'+org,randomUUID(),factId]));
 return {orgId:org,userId:'actor',scheduleId,factId,code:'authorization_revoked' as const};
}
it('durable publish is idempotent after lost response and ack survives a new adapter',async()=>{
 const fact=await failed();await service.publish(fact);
 const initial=(await service.list(viewer,{})).notifications.find(n=>n.factId===fact.factId)!;
 await Promise.all([service.publish(fact),service.publish(fact)]);
 const restarted=new PgScheduleNotifications(db,new PgIdentityRepository(db));
 expect((await restarted.list(viewer,{})).notifications.find(n=>n.factId===fact.factId)).toEqual(initial);
 expect(JSON.stringify(initial)).not.toContain('PRIVATE');expect(Object.keys(initial).sort()).toEqual(['acceptedAt','code','factId','readAt','scheduleId']);
 await Promise.all([restarted.markRead(viewer,{factId:fact.factId}),service.markRead(viewer,{factId:fact.factId})]);
 expect((await restarted.list(viewer,{})).notifications.some(n=>n.factId===fact.factId)).toBe(false);
 await restarted.publish(fact);expect((await restarted.list(viewer,{})).notifications.some(n=>n.factId===fact.factId)).toBe(false);
});
it('rejects mismatched trusted fact fields, other owner/org, and current membership revocation',async()=>{
 const fact=await failed();
 for(const changed of [{userId:'intruder'},{orgId:other},{factId:randomUUID()},{code:'delivery_rejected' as const}])await expect(service.publish({...fact,...changed})).rejects.toBeInstanceOf(ScheduleNotificationNotFoundError);
 await service.publish(fact);
 expect((await service.list({orgId:org,userId:'intruder'},{})).notifications).toEqual([]);
 await expect(service.markRead({orgId:other,userId:'actor'},{factId:fact.factId})).rejects.toBeInstanceOf(ScheduleNotificationNotFoundError);
 await expect(service.markRead({orgId:org,userId:'intruder'},{factId:fact.factId})).rejects.toBeInstanceOf(ScheduleNotificationNotFoundError);
 await asApp(org,c=>c.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,'actor']));
 try{
  await expect(service.list(viewer,{})).rejects.toBeInstanceOf(ScheduleNotificationForbiddenError);
  await expect(service.markRead(viewer,{factId:fact.factId})).rejects.toBeInstanceOf(ScheduleNotificationForbiddenError);
 }finally{await addOrgMember(org,'actor','consultant',null);}
});
it('HTTP schema binds principal identity and keeps read acknowledgment idempotent',async()=>{
 const fact=await failed();await service.publish(fact);
 class Fixture{};Module({controllers:[ScheduleNotificationsController],providers:[{provide:SCHEDULE_NOTIFICATIONS,useValue:service}]})(Fixture);
 const app=await NestFactory.create(Fixture,{logger:false});
 let principal:Principal=viewer;
 app.use((req:Request&{principal?:Principal},_res:Response,next:NextFunction)=>{req.principal=principal;next();});
 await app.listen(0,'127.0.0.1');
 try{
  const url=await app.getUrl();
  expect((await fetch(url+'/schedule-notifications?userId=intruder')).status).toBe(400);
  const get=await fetch(url+'/schedule-notifications');expect(get.status).toBe(200);expect(JSON.stringify(await get.json())).not.toContain('PRIVATE');
  const ack=(body:unknown)=>fetch(url+'/schedule-notifications/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  expect((await ack({factId:fact.factId,userId:'intruder'})).status).toBe(400);
  principal={orgId:org,userId:'intruder'};expect((await ack({factId:fact.factId})).status).toBe(404);
  principal=viewer;for(let i=0;i<2;i++){const res=await ack({factId:fact.factId});expect(res.status).toBe(200);expect(await res.json()).toEqual({read:true});}
 }finally{await app.close();}
});
