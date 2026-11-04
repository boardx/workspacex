// @global-scope-fixture table:credit_wallets: unique personal wallet and transactions are cleaned in afterAll.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner,asApp,resetOrgs} from "../support/db";
import {addChatThread,addChatMessage} from "../support/chat-db";
import type {DatabasePort} from "../../src/application/ports/database.port";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgAgentRunRepository} from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {withRunLease} from "../../src/application/agent-run/run-lease";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId(`event-meter-lock-${randomUUID().slice(0,8)}`),user=`${org}-user`,run=`${org}-run`,thread=`${org}-thread`;
const db=new PgDatabase(appConfig());
let prior:{generation:string|null;activated_at:Date|null};
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);
 await addChatThread({orgId:org,id:thread,projectId:`${org}-project`,visibilityScope:"plenary",createdBy:user});
 await addChatMessage({orgId:org,id:`${run}-input`,threadId:thread,body:"fixture",authorId:user});
 await asApp(org,c=>c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status)
 VALUES($1,$2,$3,$4,'fixture','v1','[]'::jsonb,'lock-test','fixture','running')`,[run,org,thread,`${run}-input`]));
 await asOwner(async c=>{
  prior=(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton")).rows[0];
  await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton",[generation]);
  await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,100)",[user]);
 });
});
afterAll(async()=>{
 await asOwner(async c=>{
  await c.query("DELETE FROM credit_consumption_requests WHERE org_id=$1",[org]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)",[user]);
  await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]);
  await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton",[prior.generation,prior.activated_at]);
 });await resetOrgs(org);await db.close();
});
it.each([false,true])("persists progress and a token receipt without deadlock (lease=%s)",async leased=>{
 await asOwner(async c=>{await c.query("DELETE FROM agent_execution_events WHERE org_id=$1",[org]);await c.query("UPDATE agent_runs SET lease_epoch=1,lease_expires_at=now()+interval '5 minutes' WHERE id=$1",[run]);});
 const request=`meter-${randomUUID()}`;
 await new PgTokenUsageRepository(db).startRequest(org,{requestId:request,userId:user,runId:run,modelProvider:"lock-test",modelId:"fixture",startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,threadId:thread,maximumTokens:100});
 let orgHeld!:()=>void,releaseReceipt!:()=>void,eventPid=0;
 const held=new Promise<void>(resolve=>orgHeld=resolve),release=new Promise<void>(resolve=>releaseReceipt=resolve);
 const errors:unknown[]=[];
 const receiptDb:DatabasePort={withTenant:(tenant,fn)=>db.withTenant(tenant,s=>fn({query:async<R>(sql:string,params?:readonly unknown[])=>{
  const result=await s.query<R>(sql,params).catch(e=>{errors.push(e?.code);throw e;});
  if(sql.includes("kernel_org_is_writable")&&sql.includes("FOR UPDATE")){orgHeld();await release;}
  return result;
 }})),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
 const eventDb:DatabasePort={withTenant:(tenant,fn)=>db.withTenant(tenant,async s=>{
  eventPid=(await s.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  return fn({query:async<R>(sql:string,params?:readonly unknown[])=>s.query<R>(sql,params).catch(e=>{errors.push(e?.code);throw e;})});
 }),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
 const recording=new PgTokenUsageRepository(receiptDb).record(org,{eventId:request,userId:user,runId:run,modelProvider:"lock-test",modelId:"fixture",tokensTotal:9,promptTokens:6,completionTokens:3,totalSource:"reported",outcome:"succeeded"});void recording.catch(()=>{});
 await held;
 const append=()=>new PgAgentRunRepository(eventDb).appendExecutionEvent(org,run,{kind:"status",status:"running"});
 const appending=leased?withRunLease({orgId:org,runId:run,epoch:1,verify:async()=>{}},append):append();void appending.catch(()=>{});
 let waiting=false;
 try{
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   waiting=eventPid>0&&await asOwner(async c=>(await c.query<{wait_event_type:string|null}>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[eventPid])).rows[0]?.wait_event_type==="Lock");
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));
  }
 }finally{releaseReceipt();}
 const results=await Promise.allSettled([recording,appending]);
 expect(waiting).toBe(true);expect(errors).toEqual([]);
 expect(results.flatMap(r=>r.status==="rejected"?[{code:r.reason?.code,message:r.reason?.message}]:[])).toEqual([]);
 const journal=await new PgAgentRunRepository(db).readExecutionEvents(org,run,-1);expect(journal).toHaveLength(1);expect(journal[0]).toMatchObject({seq:0,kind:"status",status:"running"});
 await asOwner(async c=>{
  expect((await c.query("SELECT count(*)::int AS n FROM token_usage_events WHERE id=$1",[request])).rows[0].n).toBe(1);
  expect((await c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE source_type='model_request' AND source_id=$1 AND type='consume'",[request])).rows[0].n).toBe(1);
  expect((await c.query("SELECT w.owner_type,w.owner_id,r.state FROM credit_consumption_requests r JOIN credit_wallets w USING(wallet_id) WHERE request_id=$1",[request])).rows[0]).toMatchObject({owner_type:"user",owner_id:user,state:"settled"});
 });
});

it("keeps lease takeover excluded until commit and refuses stale or expired worker bodies",async()=>{
 await asOwner(c=>c.query("UPDATE agent_runs SET lease_epoch=1,lease_expires_at=now()+interval '5 minutes' WHERE id=$1",[run]));
 let entered!:()=>void,releaseWriter!:()=>void,takeoverPid=0;
 const held=new Promise<void>(resolve=>entered=resolve),release=new Promise<void>(resolve=>releaseWriter=resolve);
 const lease={orgId:org,runId:run,epoch:1,verify:async()=>{}};
 const writing=withRunLease(lease,()=>db.withTenant(org,async s=>{entered();await release;await s.query("UPDATE agent_runs SET model_output='fixture committed' WHERE org_id=$1 AND id=$2",[org,run]);}));void writing.catch(()=>{});
 await held;
 const takeover=asOwner(async c=>{takeoverPid=(await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;await c.query("UPDATE agent_runs SET lease_epoch=2 WHERE id=$1",[run]);});void takeover.catch(()=>{});
 let waiting=false;
 try{
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   waiting=takeoverPid>0&&await asOwner(async c=>(await c.query<{wait_event_type:string|null}>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[takeoverPid])).rows[0]?.wait_event_type==="Lock");
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));
  }
 }finally{releaseWriter();}
 await Promise.all([writing,takeover]);expect(waiting).toBe(true);
 let invoked=false;
 const body=async()=>{invoked=true;};
 await expect(withRunLease(lease,()=>db.withTenant(org,body))).rejects.toThrow("agent_run_lease_lost");expect(invoked).toBe(false);
 await asOwner(c=>c.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[run]));
 await expect(withRunLease({...lease,epoch:2},()=>db.withTenant(org,body))).rejects.toThrow("agent_run_lease_lost");expect(invoked).toBe(false);
 expect(await asApp(org,async c=>(await c.query("SELECT model_output FROM agent_runs WHERE id=$1",[run])).rows[0].model_output)).toBe("fixture committed");
});
