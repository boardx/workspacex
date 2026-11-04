// @global-scope-fixture table:credit_wallets: unique personal wallet owners, their periods and transactions are cleaned in afterAll.
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner,resetOrgs} from "../support/db";
import type {DatabasePort} from "../../src/application/ports/database.port";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId(`personal-fallback-meter-lock-${randomUUID().slice(0,8)}`),user=`${org}-user`,db=new PgDatabase(appConfig());
let previousEpoch:{generation:string|null;activated_at:Date|null};
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,kind:"organization",projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);
 previousEpoch=await asOwner(async c=>(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton")).rows[0]);
 await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[generation]));
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,100)",[user]));
});
afterAll(async()=>{
 await asOwner(async c=>{
  await c.query("DELETE FROM credit_consumption_receipts WHERE org_id=$1",[org]);
  await c.query("DELETE FROM credit_consumption_requests WHERE org_id=$1",[org]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)",[user]);
  await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]);
  await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton",[previousEpoch.generation,previousEpoch.activated_at]);
 });await resetOrgs(org);await db.close();
});
it("finishes a real personal-fallback usage receipt while another model request waits, without an org/wallet deadlock",async()=>{
 const first=`meter-${randomUUID()}`,second=`meter-${randomUUID()}`;
 const start=(requestId:string)=>({requestId,userId:user,runId:null,modelProvider:"lock-test",modelId:"lock-model",startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:"auxiliary" as const,maximumTokens:100});
 await new PgTokenUsageRepository(db).startRequest(org,start(first));
 const observedErrors:unknown[]=[];
 let walletHeld!:()=>void,releaseReceipt!:()=>void,reservePid=0;
 const held=new Promise<void>(resolve=>walletHeld=resolve),release=new Promise<void>(resolve=>releaseReceipt=resolve);
 const receiptDb:DatabasePort={withTenant:(tenant,fn)=>db.withTenant(tenant,s=>fn({query:async<R>(sql:string,params?:readonly unknown[])=>{
  const result=await s.query<R>(sql,params).catch(error=>{observedErrors.push(error?.code);throw error;});
  if(sql.startsWith("SELECT wallet_id,balance::text,owner_type,owner_id FROM credit_wallets")){walletHeld();await release;}
  return result;
 }})),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
 const startDb:DatabasePort={withTenant:(tenant,fn)=>db.withTenant(tenant,async s=>{
  reservePid=(await s.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;return fn(s);
 }),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
 const recording=new PgTokenUsageRepository(receiptDb).record(org,{eventId:first,userId:user,runId:null,modelProvider:"lock-test",modelId:"lock-model",tokensTotal:1,promptTokens:1,completionTokens:0,totalSource:"reported",outcome:"succeeded",callPurpose:"auxiliary"});
 await held;
 const starting=new PgTokenUsageRepository(startDb).startRequest(org,start(second));void starting.catch(()=>{});
 // Observe the real blocked backend, rather than relying on a sleep to create the competing transaction.
 let waiting=false;
 try{
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   waiting=reservePid>0&&await asOwner(async c=>(await c.query<{wait_event_type:string|null}>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[reservePid])).rows[0]?.wait_event_type==="Lock");
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,5));
  }
 }finally{releaseReceipt();}
 const results=await Promise.allSettled([recording,starting]);
 expect(waiting).toBe(true);
 expect(observedErrors).toEqual([]);
 expect(results.flatMap(r=>r.status==="rejected"?[{code:r.reason?.code,message:r.reason?.message}]:[])).toEqual([]);
 await asOwner(async c=>{
  expect((await c.query("SELECT owner_id,owner_type FROM credit_wallets w JOIN credit_consumption_requests r USING(wallet_id) WHERE r.request_id=$1",[first])).rows[0]).toMatchObject({owner_type:"user",owner_id:user});
  expect((await c.query("SELECT count(*)::int AS n FROM model_request_starts WHERE org_id=$1",[org])).rows[0].n).toBe(2);
  expect((await c.query("SELECT count(*)::int AS n FROM token_usage_events WHERE org_id=$1",[org])).rows[0].n).toBe(1);
  expect((await c.query("SELECT state FROM credit_consumption_requests WHERE request_id=$1",[first])).rows[0].state).toBe("settled");
 });
});
