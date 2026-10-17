import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgBrowserExecutionReceipts} from '../../src/infrastructure/agent-run/pg-browser-execution-receipts';
import type {BrowserContext,BrowserInvocationOutput} from '../../src/application/agent-run/standard-browser-tools';
import {toOrgId} from '../../src/domain/org-id';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {seedAgentRun} from '../support/agent-run-db';
const org=toOrgId('browser-receipts-'+randomUUID()),other=toOrgId('browser-other-'+randomUUID()),thread='thread-'+randomUUID();
let db:PgDatabase;
const invocation={toolName:'browser_navigate',toolArgs:{url:'https://example.com/'}} as const;
const digest='a'.repeat(64),result:BrowserInvocationOutput={pageRef:'page:'+'b'.repeat(64),url:'https://example.com/',title:'Fixture',generation:1};
const deadline=()=>new Date(Date.now()+30000);
// SQL owns the clock. Read it after connection setup, then reuse that same
// transaction for claim; preserve original -1/+100ms boundaries and150ms wait.
async function claimWithDatabaseDeadline(database:PgDatabase,ctx:BrowserContext,offsetMs:number){
 return database.withTenant(org,async session=>{
  const expires=(await session.query<{deadline:Date}>("SELECT clock_timestamp()+$1::integer*interval '1 millisecond' AS deadline",[offsetMs])).rows[0]!.deadline;
  return new PgBrowserExecutionReceipts(database).claim(ctx,invocation,digest,expires);
 });
}
async function context():Promise<BrowserContext>{
 const run='browser-run-'+randomUUID();await seedAgentRun({orgId:org,id:run,threadId:thread,authorId:'actor',status:'running'});
 await asApp(org,async c=>{
  await c.query("UPDATE agent_runs SET started_at=now()-interval '1 second',lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE org_id=$1 AND id=$2",[org,run]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });return {orgId:org,parentRunId:run,attemptId:run+':0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:randomUUID()};
}
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());for(const orgId of [org,other]){await seedOrg({orgId,projectId:'project-'+orgId});await addOrgMember(orgId,'actor','consultant',null);}await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});});
afterAll(async()=>{await db?.close();await resetOrgs(org,other);});
it('real PG stores success and replays exact result from a fresh connection while changed args conflict',async()=>{
 const ctx=await context(),first=new PgBrowserExecutionReceipts(db);expect(await first.claim(ctx,invocation,digest,deadline())).toEqual({kind:'claimed'});await first.succeed(ctx,invocation,digest,result);
 const restartedDb=new PgDatabase(appConfig());try{const restarted=new PgBrowserExecutionReceipts(restartedDb);expect(await restarted.claim(ctx,invocation,digest,deadline())).toEqual({kind:'succeeded',result});await expect(restarted.claim(ctx,invocation,'c'.repeat(64),deadline())).rejects.toThrow('conflict');}finally{await restartedDb.close();}
});
it('two actual connections admit only one execution and unknown pending is never replayed as a claim',async()=>{
 const ctx=await context(),secondDb=new PgDatabase(appConfig());try{
  const outcomes=await Promise.all([new PgBrowserExecutionReceipts(db).claim(ctx,invocation,digest,deadline()),new PgBrowserExecutionReceipts(secondDb).claim(ctx,invocation,digest,deadline())]);
  expect(outcomes.map(x=>x.kind).sort()).toEqual(['claimed','unconfirmed']);
  expect(await new PgBrowserExecutionReceipts(secondDb).claim(ctx,invocation,digest,deadline())).toEqual({kind:'unconfirmed'});
  await new PgBrowserExecutionReceipts(db).markUnconfirmed(ctx,invocation,digest,'session_launch_failed');
  await expect(new PgBrowserExecutionReceipts(secondDb).succeed(ctx,invocation,digest,result)).rejects.toThrow('unconfirmed');
  const stored=await asApp(org,async c=>(await c.query('SELECT status,unconfirmed_reason FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[org,ctx.parentRunId,ctx.toolCallId])).rows[0]);
  expect(stored).toEqual({status:'unconfirmed',unconfirmed_reason:'session_launch_failed'});
 }finally{await secondDb.close();}
});
it('wrong attempt, lease and organization cannot claim or publish another running receipt',async()=>{
 const ctx=await context(),store=new PgBrowserExecutionReceipts(db);
 for(const patch of [{attemptId:ctx.parentRunId+':99'},{leaseEpoch:2},{orgId:other}])await expect(store.claim({...ctx,...patch},invocation,digest,deadline())).rejects.toThrow();
 expect(await store.claim(ctx,invocation,digest,deadline())).toEqual({kind:'claimed'});
 for(const patch of [{attemptId:ctx.parentRunId+':99'},{leaseEpoch:2},{orgId:other}])await expect(store.succeed({...ctx,...patch},invocation,digest,result)).rejects.toThrow('unconfirmed');
 await store.succeed(ctx,invocation,digest,result);
});
it.each([-1000,0,1000])('timeout rejects late completion and keeps an honest unknown receipt across restart (host clock offset %i ms)',async offset=>{
 const ctx=await context(),store=new PgBrowserExecutionReceipts(db),nativeNow=Date.now.bind(Date);
 // Controlled Node-only skew; database clocks and all real timers stay unchanged.
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>nativeNow()+offset);
 try{
  await expect(claimWithDatabaseDeadline(db,ctx,-1)).rejects.toThrow('refused');
  await claimWithDatabaseDeadline(db,ctx,100);
  await asApp(org,c=>c.query('SELECT pg_sleep(0.15)'));
  await expect(store.succeed(ctx,invocation,digest,result)).rejects.toThrow('unconfirmed');
  expect(await new PgBrowserExecutionReceipts(db).claim(ctx,invocation,digest,deadline())).toEqual({kind:'unconfirmed'});
 }finally{clock.mockRestore();}
});
it('reads the claim deadline after real connection setup, within the same transaction',async()=>{
 const ctx=await context(),privateDb=new PgDatabase(appConfig()),original=pg.Pool.prototype.connect;
 let armed=true,delayed=0,observedDelayMs=0;
 // Preserve real checkout and callback overloads. Only inject connection setup
 // latency; never intercept SQL or claim results, or extend the100ms deadline.
 const wrapped=function(this:pg.Pool,...args:unknown[]){
  const out:unknown=Reflect.apply(original,this,args);
  if(typeof args[0]==='function'||!armed)return out;
  armed=false;delayed++;
  return (out as Promise<pg.PoolClient>).then(async client=>{
   const start=performance.now();
   await new Promise<void>(resolve=>setTimeout(resolve,150));
   observedDelayMs=performance.now()-start;
   return client;
  });
 } as typeof original;
 const checkout=vi.spyOn(pg.Pool.prototype,'connect').mockImplementation(wrapped);
 try{
  expect(await claimWithDatabaseDeadline(privateDb,ctx,100)).toEqual({kind:'claimed'});
  expect(delayed).toBe(1);expect(observedDelayMs).toBeGreaterThanOrEqual(100);
  expect(checkout).toHaveBeenCalledTimes(1);
 }finally{checkout.mockRestore();await privateDb.close();}
});
it('parent cancellation committed before settlement denies late output and any new execution',async()=>{
 const ctx=await context(),store=new PgBrowserExecutionReceipts(db);await store.claim(ctx,invocation,digest,deadline());
 await asApp(org,c=>c.query("UPDATE agent_runs SET cancel_requested_at=now(),status='cancelled' WHERE org_id=$1 AND id=$2",[org,ctx.parentRunId]));
 await expect(store.succeed(ctx,invocation,digest,result)).rejects.toThrow('unconfirmed');
 await expect(store.claim({...ctx,toolCallId:randomUUID()},invocation,digest,deadline())).rejects.toThrow('unavailable');
 const row=await asApp(org,async c=>(await c.query('SELECT status,result FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[org,ctx.parentRunId,ctx.toolCallId])).rows[0]);expect(row).toEqual({status:'pending',result:null});
});
it('claim waiting behind the parent row lock observes committed cancellation and creates no receipt',async()=>{
 const ctx=await context();let cancelClaim:Promise<unknown>|undefined;
 await db.withTenant(org,async s=>{
  await s.query('SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[org,ctx.parentRunId]);
  const separate=new PgDatabase(appConfig());let notifyPid!:(pid:number)=>void;const pidReady=new Promise<number>(resolve=>{notifyPid=resolve;});
  cancelClaim=separate.withTenant(org,async inner=>{
   const pid=(await inner.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;notifyPid(pid);
   return new PgBrowserExecutionReceipts(separate).claim(ctx,invocation,digest,deadline());
  }).then(value=>({value}),error=>({error})).finally(()=>separate.close());
  const pid=await pidReady;let waiting=false;
  for(let n=0;n<30;n++){
   await s.query('SELECT pg_stat_clear_snapshot()');
   const row=(await s.query<{wait_event_type:string|null}>('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
   if(row?.wait_event_type==='Lock'){waiting=true;break;}await s.query('SELECT pg_sleep(0.01)');
  }
  expect(waiting).toBe(true);
  await s.query("UPDATE agent_runs SET cancel_requested_at=now(),status='cancelled' WHERE org_id=$1 AND id=$2",[org,ctx.parentRunId]);
 });
 expect(await cancelClaim).toHaveProperty('error');
 const count=await asApp(org,async c=>(await c.query('SELECT count(*)::int AS n FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,ctx.parentRunId])).rows[0].n);expect(count).toBe(0);
});
