import type {z} from 'zod';
import type {ScheduleWake as ScheduleWakeSchema} from '@repo/contracts/standard-schedule';
import {AsyncLocalStorage} from 'node:async_hooks';
import {PgBoss,type Job} from 'pg-boss';
import {CronExpressionParser} from 'cron-parser';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
export const SCHEDULE_QUEUE='workspacex-scheduled-run';
export const SCHEDULE_SCHEMA='workspacex_scheduler';
export type ScheduleWake=z.infer<typeof ScheduleWakeSchema>;
/** Official pg-boss owns due-time evaluation, persistent claims, retries and cron.
 * Private transaction binding is required because schedule/unschedule ignore options.db. */
export class PgBossScheduler {
 readonly boss:PgBoss;
 private readonly transaction=new AsyncLocalStorage<TenantSession>();
 private started=false;
 constructor(db:DatabasePort,reportError:(code:'schedule_provider_error')=>void){
  this.boss=new PgBoss({schema:SCHEDULE_SCHEMA,migrate:false,createSchema:false,
   db:{executeSql:async (sql,values)=>{
    const active=this.transaction.getStore();
    return active?active.query(sql,values):db.withoutTenant(s=>s.query(sql,values));
   }},reindex:false});
  // Do not print SDK query data or credentials. The composition root may observe
  // this generic status, but a failed startup is never treated as available.
  this.boss.on('error',()=>reportError('schedule_provider_error')); 
 }
 async start(handler:(job:Job<ScheduleWake>)=>Promise<void>){
  await this.boss.start();
  await this.boss.work<ScheduleWake>(SCHEDULE_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async jobs=>{
   for(const job of jobs)await handler(job);
  });
  this.started=true;
 }
 async stop(){this.started=false;await this.boss.stop({graceful:true,timeout:10000});}
 assertAvailable(){if(!this.started)throw new Error('schedule_provider_unavailable');}
 inTransaction<T>(session:TenantSession,callback:()=>Promise<T>){return this.transaction.run(session,callback);}
 async create(id:string,orgId:string,input:{trigger:'once';at:string}|{trigger:'cron';expression:string;timezone:string}){
  this.assertAvailable();
  const data={orgId,scheduleId:id};
  if(input.trigger==='cron'){
   await this.boss.schedule(SCHEDULE_QUEUE,input.expression,data,{key:id,tz:input.timezone,retryLimit:20,retryDelay:5,retryBackoff:true,deleteAfterSeconds:604800});
  }else{
   const jobId=await this.boss.send(SCHEDULE_QUEUE,data,{id,startAfter:new Date(input.at),retryLimit:20,retryDelay:5,retryBackoff:true,deleteAfterSeconds:604800});
   if(jobId!==id)throw new Error('schedule_provider_conflict');
  }
 }
 async cancel(id:string){
  await this.boss.unschedule(SCHEDULE_QUEUE,id);
  await this.boss.cancel(SCHEDULE_QUEUE,id);
 }
 async next(id:string):Promise<string|null>{
  const schedule=(await this.boss.getSchedules(SCHEDULE_QUEUE,id))[0];
  if(schedule)return CronExpressionParser.parse(schedule.cron,{tz:schedule.timezone,strict:false}).next().toDate().toISOString();
  const job=await this.boss.getJobById(SCHEDULE_QUEUE,id);
  return job&&['created','retry'].includes(job.state)?job.startAfter.toISOString():null;
 }
}
