// @global-scope-fixture table:credit_wallets: unique personal wallet owners are deleted in afterAll; the isolated runner also drops the owned database.
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,beforeEach,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId,type OrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
const prefix=`fallback-${randomUUID().slice(0,8)}`,user=`${prefix}-user`,other=`${prefix}-other`;
const unpaid=toOrgId(`${prefix}-unpaid`),second=toOrgId(`${prefix}-second`),team=toOrgId(`${prefix}-team`),enterprise=toOrgId(`${prefix}-enterprise`);
const orgs=[unpaid,second,team,enterprise],db=new PgDatabase(appConfig());
let at=new Date(),priorEpoch:unknown;
const credits=new PgCreditConsumption(db,()=>at);
const input=(id:string)=>({requestId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:"test",modelId:"fixture",executionAttemptId:null,projectId:null,startedAt:at.toISOString(),maximumTokens:1000});
const reserve=(org:OrgId,id:string)=>db.withTenant(org,s=>credits.reserveInSession(s,org,input(id)));
const settle=(org:OrgId,id:string)=>db.withTenant(org,s=>credits.settleInSession(s,org,{eventId:input(id).requestId,userId:user,runId:null,modelProvider:"test",modelId:"fixture",tokensTotal:1000,promptTokens:600,completionTokens:400,totalSource:"reported",outcome:"succeeded"}));
const owner=(id:string)=>asOwner(async c=>(await c.query("SELECT w.owner_type,w.owner_id,r.state FROM credit_consumption_requests r JOIN credit_wallets w USING(wallet_id) WHERE r.request_id=$1",[input(id).requestId])).rows[0]);
const balance=(type:string,id:string)=>asOwner(async c=>Number((await c.query("SELECT balance FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2",[type,id])).rows[0]?.balance));
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();
 await asOwner(async c=>{priorEpoch=(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton")).rows[0];await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton",[generation]);});
 for(const org of orgs){await seedOrg({orgId:org,projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);}
 await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[enterprise,generation]));
 const quoteRef=`quote-${randomUUID()}`,quote={orgId:team,generation,quoteRef,catalogVersion:"frozen",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:12345,createdAt:at.toISOString(),expiresAt:new Date(at.getTime()+300000).toISOString(),purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quoteRef,team,generation,quote,at,quote.expiresAt]));
 const p=await new PgTeamCheckoutRepository(db,{authorize:async()=>team} as never,()=>true,()=>at).reserve({orgId:team,userId:user},team,{quoteRef,idempotencyKey:`paid-${randomUUID()}`});
 await new PgTeamPaymentRepository(db,()=>at).settle(team,{provider:"wechat",purchaseRef:p.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll("-","")}`,amountMinor:12345,currency:"CNY",paidAt:at});
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,20000),('user',$2,30000),('team',$3,10)",[user,other,enterprise]));
});
beforeEach(async()=>{at=new Date();await asOwner(async c=>{await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[orgs]);await c.query("DELETE FROM member_credit_quota WHERE org_id=ANY($1::text[])",[orgs]);await c.query("UPDATE credit_wallets SET balance=20000,held_hundredths=0,unbounded_requests=0 WHERE owner_type='user' AND owner_id=$1",[user]);await c.query("UPDATE credit_wallets SET balance=10,held_hundredths=0,unbounded_requests=0 WHERE owner_type='team' AND owner_id=ANY($1::text[])",[[team,enterprise]]);await c.query("UPDATE credit_subscription_periods SET remaining_hundredths=0 WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[team]);});});
afterAll(async()=>{await asOwner(async c=>{
 await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[orgs]);
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[[user,other]]);
 await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[[user,other]]);
 await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[[user,other]]);
 const old=priorEpoch as {generation:string|null;activated_at:Date|null};await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton",[old.generation,old.activated_at]);
});await db.close();});

it("non-enterprise paid organizations always use personal credits",async()=>{await reserve(team,"paid-personal");expect(await owner("paid-personal")).toMatchObject({owner_type:"user",owner_id:user});});
it("enterprise last quota slot admits one team request and one personal request concurrently",async()=>{
 await asOwner(c=>c.query("INSERT INTO member_credit_quota(org_id,user_id,monthly_limit,updated_by) VALUES($1,$2,1,$2) ON CONFLICT(org_id,user_id) DO UPDATE SET monthly_limit=1",[enterprise,user]));
 await Promise.all([reserve(enterprise,"quota-a"),reserve(enterprise,"quota-b")]);
 const owners=await Promise.all([owner("quota-a"),owner("quota-b")]);expect(owners.map(x=>x.owner_type).sort()).toEqual(["team","user"]);
});
it("cross-org concurrent personal holds cannot overspend one wallet",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=1 WHERE owner_type='user' AND owner_id=$1",[user]));
 const results=await Promise.allSettled([reserve(unpaid,"wallet-a"),reserve(second,"wallet-b")]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const rejected=results.find(r=>r.status==="rejected") as PromiseRejectedResult;expect(rejected.reason).toMatchObject({code:"credit_required",ownerType:"user"});
});
it("unknown-cost holds exclusively reserve personal capacity without a fabricated charge",async()=>{
 const request={...input("unknown"),maximumTokens:null};
 await db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,request));
 await expect(reserve(second,"after-unknown")).rejects.toMatchObject({code:"credit_required",ownerType:"user"});
 expect(await balance("user",user)).toBe(20000);
});
it("replays keep their admitted payer after enterprise quota changes",async()=>{
 await reserve(enterprise,"fixed-team");
 await asOwner(c=>c.query("INSERT INTO member_credit_quota(org_id,user_id,monthly_limit,updated_by) VALUES($1,$2,0,$2) ON CONFLICT(org_id,user_id) DO UPDATE SET monthly_limit=0",[enterprise,user]));
 await reserve(enterprise,"fixed-team");expect(await owner("fixed-team")).toMatchObject({owner_type:"team",owner_id:enterprise});
});
it("partial receipts release only consumed capacity and final replay releases once",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=100 WHERE owner_type='user' AND owner_id=$1",[user]));
 await db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,{...input("stream"),maximumTokens:50000}));
 const receipt=(id:string,final:boolean,tokens:number)=>db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,{eventId:input("stream").requestId,userId:user,runId:null,modelProvider:"test",modelId:"fixture",tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:"reported",outcome:"succeeded",billingReceipt:{id,final}}));
 await receipt("part",false,30000);
 await db.withTenant(second,s=>credits.reserveInSession(s,second,{...input("parallel-stream"),maximumTokens:50000}));
 await receipt("final",true,30000);await receipt("final",true,30000);
 const wallet=await asOwner(async c=>(await c.query("SELECT balance::text,held_hundredths::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0]);
 expect(Number(wallet.balance)).toBe(70);expect(wallet.held_hundredths).toBe("5000");
});
it("zero and insufficient personal wallets reject before creating a request",async()=>{
 for(const amount of [0,0.5]){
  await asOwner(c=>c.query("UPDATE credit_wallets SET balance=$2 WHERE owner_type='user' AND owner_id=$1",[user,amount]));
  await expect(reserve(unpaid,`poor-${amount}`)).rejects.toMatchObject({code:"credit_required",ownerType:"user"});
  expect(await owner(`poor-${amount}`)).toBeUndefined();
 }
});
it("unknown terminal retains capacity until authoritative reconciliation",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=10 WHERE owner_type='user' AND owner_id=$1",[user]));
 await reserve(unpaid,"uncertain");
 const usage={eventId:input("uncertain").requestId,userId:user,runId:null,modelProvider:"test",modelId:"fixture",tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:"unknown" as const,outcome:"failed" as const};
 await db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,usage));
 const held=()=>asOwner(async c=>(await c.query("SELECT held_hundredths::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0].held_hundredths);
 expect(await held()).toBe("100");
 await credits.reconcile(unpaid,{...usage,totalSource:"reported",tokensTotal:500,promptTokens:500,completionTokens:0});
 expect(await held()).toBe("0");
 await credits.reconcile(unpaid,{...usage,totalSource:"reported",tokensTotal:500,promptTokens:500,completionTokens:0});
 expect(await held()).toBe("0");
});
it("migrates historical gross pending holds before partial and final receipts",async()=>{
 await db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,{...input("legacy-stream"),maximumTokens:50000}));
 const usage={eventId:input("legacy-stream").requestId,userId:user,runId:null,modelProvider:"test",modelId:"fixture",tokensTotal:30000,promptTokens:30000,completionTokens:0,totalSource:"reported" as const,outcome:"succeeded" as const};
 await db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,{...usage,billingReceipt:{id:"legacy-part",final:false}}));
 await asOwner(c=>c.query("UPDATE credit_wallets SET held_hundredths=5000 WHERE owner_type='user' AND owner_id=$1",[user]));
 const {readFileSync}=await import("node:fs");
 const migration=readFileSync(new URL("../../migrations/20261108120000_credit_remaining_holds.sql",import.meta.url),"utf8");
 await asOwner(async c=>{await c.query("BEGIN");try{await c.query(migration);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}});
 const held=()=>asOwner(async c=>(await c.query("SELECT held_hundredths::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0].held_hundredths);
 expect(await held()).toBe("5000");
 const remaining=await asOwner(async c=>(await c.query("SELECT remaining_held_hundredths::text AS n FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0].n);
 expect(remaining).toBe("2000");
 await db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,{...usage,tokensTotal:40000,promptTokens:40000,billingReceipt:{id:"next",final:false}}));
 expect(await held()).toBe("5000");
 const final={...usage,tokensTotal:40000,promptTokens:40000,billingReceipt:{id:"last",final:true}};
 await db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,final));await db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,final));
 expect(await held()).toBe("0");
});
it("legacy request updates and deletes maintain additive holds without changing gross semantics",async()=>{
 await reserve(unpaid,"old-writer");
 const snapshot=()=>asOwner(async c=>(await c.query("SELECT held_hundredths::text AS gross,remaining_held_hundredths::text AS remaining FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0]);
 expect(await snapshot()).toEqual({gross:"100",remaining:"100"});
 // Same wallet-first SQL boundary used by the legacy receipt writer.
 await db.withTenant(unpaid,async s=>{
  await s.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",[user]);
  await s.query("UPDATE credit_consumption_requests SET state='pending',debited_hundredths=30 WHERE request_id=$1",[input("old-writer").requestId]);
 });
 expect(await snapshot()).toEqual({gross:"100",remaining:"70"});
 await expect(db.withTenant(unpaid,async s=>{
  await s.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",[user]);
  await s.query("UPDATE credit_consumption_requests SET debited_hundredths=60 WHERE request_id=$1",[input("old-writer").requestId]);
  throw new Error("rollback-probe");
 })).rejects.toThrow("rollback-probe");
 expect(await snapshot()).toEqual({gross:"100",remaining:"70"});
 await expect(db.withTenant(unpaid,s=>s.query("DELETE FROM credit_consumption_requests WHERE request_id=$1",[input("old-writer").requestId]))).rejects.toThrow("permission denied");
 // DELETE remains an owner-only maintenance operation; never grant it to runtime.
 await asOwner(async c=>{await c.query("BEGIN");try{
  await c.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",[user]);
  await c.query("DELETE FROM credit_consumption_requests WHERE request_id=$1",[input("old-writer").requestId]);
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}});
 expect(await snapshot()).toEqual({gross:"100",remaining:"0"});
});
it("runtime trigger is invoker-only and request wallet reassignment fails atomically",async()=>{
 await reserve(unpaid,"immutable-wallet");
 const meta=await asOwner(async c=>(await c.query("SELECT prosecdef FROM pg_proc WHERE oid='public.kernel_credit_remaining_hold_delta()'::regprocedure")).rows[0]);
 expect(meta.prosecdef).toBe(false);
 await expect(db.withTenant(unpaid,async s=>{
  await s.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",[user]);
  await s.query("UPDATE credit_consumption_requests SET wallet_id=(SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$2) WHERE request_id=$1",[input("immutable-wallet").requestId,other]);
 })).rejects.toThrow("credit_request_wallet_immutable");
 expect(await owner("immutable-wallet")).toMatchObject({owner_type:"user",owner_id:user});
});
it("migration refuses a concurrent legacy writer without altering either hold projection",async()=>{
 await reserve(unpaid,"migration-active");
 const {readFileSync}=await import("node:fs");
 const migration=readFileSync(new URL("../../migrations/20261108120000_credit_remaining_holds.sql",import.meta.url),"utf8");
 await asOwner(async writer=>{
  await writer.query("BEGIN");
  try{
   await writer.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",[user]);
   await asOwner(async migrator=>{
    await migrator.query("BEGIN");
    try{await expect(migrator.query(migration)).rejects.toMatchObject({code:"55P03"});}
    finally{await migrator.query("ROLLBACK");}
   });
   const row=(await writer.query("SELECT held_hundredths::text AS gross,remaining_held_hundredths::text AS remaining FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0];
   expect(row).toEqual({gross:"100",remaining:"100"});
  }finally{await writer.query("ROLLBACK");}
 });
});

it("personal continuation protects other holds without double counting its own",async()=>{
 const {assertMemberCreditContinuation}=await import('../../src/infrastructure/billing/member-credit-quota');
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=100 WHERE owner_type='user' AND owner_id=$1",[user]));
 await Promise.all([
  db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,{...input('live'),maximumTokens:50000})),
  db.withTenant(second,s=>credits.reserveInSession(s,second,{...input('other'),maximumTokens:50000})),
 ]);
 const check=()=>db.withTenant(unpaid,s=>assertMemberCreditContinuation(s,unpaid,user,input('live').requestId));
 await expect(check()).resolves.toBeUndefined();
 const receipt=(tokens:number)=>db.withTenant(unpaid,s=>credits.settleInSession(s,unpaid,{eventId:input('live').requestId,userId:user,runId:null,modelProvider:'test',modelId:'fixture',tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:'reported',outcome:'succeeded',billingReceipt:{id:`part-${tokens}`,final:false}}));
 await receipt(50000);
 await expect(check()).rejects.toMatchObject({code:'credit_required',ownerType:'user',ownerId:user});
 expect(await balance('user',user)).toBe(50);
 await receipt(110000);
 expect(await balance('user',user)).toBe(-10);
 await expect(check()).rejects.toMatchObject({code:'credit_required',ownerType:'user'});
});
it.each(['membership','organization'] as const)('revoked %s stops continuation while incurred usage still settles',async boundary=>{
 const {assertMemberCreditContinuation}=await import('../../src/infrastructure/billing/member-credit-quota');
 const id=`revoked-continuation-${boundary}`;
 await reserve(unpaid,id);
 await asOwner(c=>boundary==='membership'?c.query("DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2",[unpaid,user]):c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '30 days' WHERE id=$1",[unpaid]));
 try{
  await settle(unpaid,id);
  expect(await balance('user',user)).toBe(19999);
  await expect(db.withTenant(unpaid,s=>assertMemberCreditContinuation(s,unpaid,user,input(id).requestId))).rejects.toMatchObject({code:'credit_accounting_unavailable'});
 }finally{
  await asOwner(c=>boundary==='membership'?c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[unpaid,user]):c.query("UPDATE organizations SET status='active',disabled_at=NULL,retention_until=NULL WHERE id=$1",[unpaid]));
 }
});

it("disabled organization cannot create a new personal reservation",async()=>{
 await reserve(unpaid,'already-dispatched');
 await asOwner(c=>c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '30 days' WHERE id=$1",[unpaid]));
 try{
  await expect(reserve(unpaid,'disabled-new')).rejects.toMatchObject({code:'credit_accounting_unavailable'});
  expect(await owner('disabled-new')).toBeUndefined();
  await settle(unpaid,'already-dispatched');
  expect(await owner('already-dispatched')).toMatchObject({state:'settled',owner_type:'user',owner_id:user});
 }finally{await asOwner(c=>c.query("UPDATE organizations SET status='active',disabled_at=NULL,retention_until=NULL WHERE id=$1",[unpaid]));}
});
it("row security off refuses filtered backfill visibility without bypass",async()=>{
 await reserve(unpaid,'visibility');
 const role=await db.withTenant(unpaid,async s=>(await s.query<{rolbypassrls:boolean}>("SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]);
 expect(role?.rolbypassrls).toBe(false);
 const table=await asOwner(async c=>(await c.query("SELECT relforcerowsecurity FROM pg_class WHERE oid='public.credit_consumption_requests'::regclass")).rows[0]);
 expect(table.relforcerowsecurity).toBe(true);
 await expect(db.withTenant(unpaid,async s=>{
  await s.query("SET LOCAL row_security=off");
  await s.query("SELECT SUM(GREATEST(reserved_hundredths-COALESCE(debited_hundredths,0),0)) FROM public.credit_consumption_requests WHERE state<>'settled'");
 })).rejects.toMatchObject({code:'42501'});
});
