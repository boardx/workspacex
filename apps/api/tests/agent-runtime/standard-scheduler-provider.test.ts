import {it,expect} from 'vitest';
import {CronExpressionParser} from 'cron-parser';
import {randomUUID} from 'node:crypto';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {ensureDatabase,migrateOnce} from '../support/db';
import {PgBossScheduler,SCHEDULE_QUEUE} from '../../src/infrastructure/agent-run/pg-boss-scheduler';
import {setupPgBossScheduler} from '../../src/infrastructure/agent-run/setup-pg-boss-scheduler';
const waitFor=async(predicate:()=>boolean)=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw new Error('worker did not dispatch');await new Promise(r=>setTimeout(r,30));}};
it('official persistent due job survives restart and two workers claim only once',async()=>{
 ensureDatabase();await migrateOnce();await setupPgBossScheduler(migrationConfig());
 const db=new PgDatabase(appConfig()),seen:string[]=[];
 const errors:string[]=[];let provider=new PgBossScheduler(db,code=>errors.push(code));
 const id=randomUUID();
 try{
  await provider.start(async job=>{seen.push(job.id);});
  await provider.create(id,'test-org',{trigger:'once',at:new Date(Date.now()+1500).toISOString()});
  await provider.stop();
  await new Promise(r=>setTimeout(r,1700));
  provider=new PgBossScheduler(db,code=>errors.push(code));
  const other=new PgBossScheduler(db,code=>errors.push(code));
  try{
   await Promise.all([provider.start(async job=>{seen.push(job.id);}),other.start(async job=>{seen.push(job.id);})]);
   await waitFor(()=>seen.includes(id));await new Promise(r=>setTimeout(r,1200));
   expect(seen.filter(value=>value===id)).toHaveLength(1);
   expect(errors).toEqual([]);
  }finally{await other.stop();}
 }finally{await provider.stop();await db.close();}
},60000);
it('SDK transaction binding rolls cron and one-shot registration back together',async()=>{
 ensureDatabase();await migrateOnce();await setupPgBossScheduler(migrationConfig());
 const db=new PgDatabase(appConfig()),provider=new PgBossScheduler(db,()=>{});const id=randomUUID(),once=randomUUID();
 try{
  await provider.start(async()=>{});
  await expect(db.withoutTenant(session=>provider.inTransaction(session,async()=>{
   await provider.create(id,'test-org',{trigger:'cron',expression:'30 9 * * *',timezone:'America/New_York'});
   await provider.create(once,'test-org',{trigger:'once',at:new Date(Date.now()+60000).toISOString()});
   throw new Error('rollback proof');
  }))).rejects.toThrow('rollback proof');
  expect(await provider.boss.getSchedules(SCHEDULE_QUEUE,id)).toEqual([]);
  expect(await provider.boss.getJobById(SCHEDULE_QUEUE,once)).toBeNull();
 }finally{await provider.stop();await db.close();}
},60000);
it('uses pg-boss identical parser for timezone and DST display, never its own timer',()=>{
 const options={tz:'America/New_York',strict:false,currentDate:new Date('2027-03-13T15:00:00Z')};
 expect(CronExpressionParser.parse('30 9 * * *',options).next().toISOString()).toBe('2027-03-14T13:30:00.000Z');
 expect(()=>CronExpressionParser.parse('30 9 * * *',{...options,tz:'Not/AZone'}).next()).toThrow();
});
