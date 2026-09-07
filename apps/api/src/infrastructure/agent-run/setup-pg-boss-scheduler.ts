/** Explicit deployment migration step; never called by the runtime composition root. */
import {PgBoss} from 'pg-boss';
import pg from 'pg';
import type {PgConfig} from '../db/pg-config';
import {SCHEDULE_QUEUE,SCHEDULE_SCHEMA} from './pg-boss-scheduler';
export async function setupPgBossScheduler(config:PgConfig){
 const boss=new PgBoss({...config,schema:SCHEDULE_SCHEMA,reindex:false});
 let failure:unknown;
 boss.on('error',error=>{failure=error;});
 try{
  await boss.start();
  await boss.createQueue(SCHEDULE_QUEUE,{retryLimit:20,retryDelay:5,retryBackoff:true,deleteAfterSeconds:604800});
  if(failure)throw new Error('scheduler_setup_failed');
 }finally{await boss.stop({graceful:true,timeout:10000});}
 const client=new pg.Client(config);await client.connect();
 try{
  // Constant SDK namespace and existing least-privilege runtime role only.
  await client.query(`GRANT USAGE ON SCHEMA ${SCHEDULE_SCHEMA} TO app_rw`);
  await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${SCHEDULE_SCHEMA} TO app_rw`);
  await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${SCHEDULE_SCHEMA} TO app_rw`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${SCHEDULE_SCHEMA} TO app_rw`);
 }finally{await client.end();}
}
