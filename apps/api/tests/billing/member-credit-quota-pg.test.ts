import {EnterpriseCreditPlanRequired} from "../../src/application/auth/member-credit-quota-port";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp,asOwner} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgCreditConsumption} from '../../src/infrastructure/billing/pg-credit-consumption';
import {PgMemberCreditQuotaRepository} from '../../src/infrastructure/billing/pg-member-credit-quota-repository';
import {assertMemberCreditContinuation,readMemberCreditUsage} from '../../src/infrastructure/billing/member-credit-quota';
import {toOrgId} from '../../src/domain/org-id';
const prefix=`member-credit-${randomUUID()}`,org=toOrgId(prefix),other=toOrgId(`${prefix}-other`),user=`${prefix}-user`,db=new PgDatabase(appConfig());
const store=new PgCreditConsumption(db),repo=new PgMemberCreditQuotaRepository(db);
let originalEpoch:{generation:string|null;activated_at:Date|null}|undefined;
const start=(id:string,tokens=1000)=>({requestId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'test',modelId:'test',startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,maximumTokens:tokens});
const reserve=(id:string,tokens=1000)=>db.withTenant(org,s=>store.reserveInSession(s,org,start(id,tokens)));
const settle=(id:string,tokens:number)=>db.withTenant(org,s=>store.settleInSession(s,org,{eventId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'test',modelId:'test',tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:'reported',outcome:'succeeded'}));
// @global-scope-fixture table:credit_transactions: immutable exact prefix fixture debit rows retained in disposable DB.
// @global-scope-fixture table:credentials: exact prefix user retained in disposable DB, no unrelated user reads or writes.
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();
 originalEpoch=await asOwner(async c=>(await c.query('SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton')).rows[0]);
 await asOwner(c=>c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton',[generation]));
 await seedOrg({orgId:org,projectId:`${prefix}-project`});await seedOrg({orgId:other,projectId:`${prefix}-other-project`});
 await asApp(org,async c=>{
  await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'Credit member','$2b$12$test-fixture-already-hashed')",[user,`${user}@example.test`]);
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[org,user]);
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,$2,$3)",[org,user,generation]);
 });
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='user' AND owner_id=$1",[user]));
},180000);
afterAll(async()=>{await db.close();if(originalEpoch)await asOwner(c=>c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton',[originalEpoch!.generation,originalEpoch!.activated_at]));console.info('[member-credit-fixture-retention]',JSON.stringify({org,other,user}));});
it('defaults existing members without writing quota or wallet funds; applies to new members',async()=>{
 const first=await repo.readCreditQuotas(org);expect(first.members[0]).toMatchObject({monthlyLimit:5000,overridden:false,usedCredits:0});
 expect(await asApp(org,async c=>(await c.query('SELECT count(*)::int AS n FROM member_credit_quota WHERE org_id=$1',[org])).rows[0].n)).toBe(0);
 expect(await asApp(org,async c=>(await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].n)).toBe(0);
 const newcomer=`${prefix}-new`;await asApp(org,async c=>{
  await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'New member','$2b$12$test-fixture-already-hashed')",[newcomer,`${newcomer}@example.test`]);
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'consultant')",[org,newcomer]);
 });expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===newcomer)).toMatchObject({monthlyLimit:5000,overridden:false});
 const guest=`${prefix}-guest`;
 await asApp(org,c=>c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'consultant')",[org,guest]));
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===guest)).toMatchObject({displayName:guest,email:'',monthlyLimit:5000,overridden:false});
 await repo.setCreditQuota(org,guest,42,user);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===guest)).toMatchObject({monthlyLimit:42,overridden:true});
});
it('serializes concurrent reservations and applies zero/custom overrides without minting funds',async()=>{
 await repo.setCreditQuota(org,user,1,user);
 const result=await Promise.allSettled([reserve('a',600),reserve('b',600)]);
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.filter(r=>r.status==='rejected')).toHaveLength(1);
 const admitted=result[0]!.status==='fulfilled'?'a':'b';await settle(admitted,600);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({monthlyLimit:1,usedCredits:0.6,heldCredits:0,overridden:true});
 await repo.setCreditQuota(org,user,0,user);await expect(reserve('zero',1)).rejects.toMatchObject({code:'credit_required'});
 await repo.setCreditQuota(org,user,2500,user);await reserve('custom',1500000);await settle('custom',0);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)?.monthlyLimit).toBe(2500);
});
it('uses actual debit UTC calendar month, excluding previous month and retaining prior-month outstanding holds',async()=>{
 // Financial timestamps are immutable; create an old fixture directly rather than UPDATE an audited debit.
 await asOwner(async c=>{
  const wallet=(await c.query("SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].wallet_id;
  await c.query("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,created_at) VALUES($1,'consume',-1,999,-999,'model_request',$2,$3,(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second')",[wallet,`${prefix}-old`,user]);
 });
 await reserve('old-hold',1000);await asOwner(c=>c.query("UPDATE credit_consumption_requests SET created_at=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 day' WHERE request_id=$1",[`${prefix}-old-hold`]));
 const usage=await db.withTenant(org,s=>readMemberCreditUsage(s,org,user));expect(usage).toMatchObject({used:60n,held:100n});
 await repo.setCreditQuota(org,user,1,user);await expect(reserve('new-month-over',1)).rejects.toMatchObject({code:'credit_required'});
 await settle('old-hold',0);await reserve('new-month-fit',400);await settle('new-month-fit',400);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:1,heldCredits:0});
});
it('blocks cross-tenant quota writes and outsiders without altering existing overrides',async()=>{
 await expect(repo.setCreditQuota(org,'outsider',9,user)).rejects.toThrow('MEMBER_NOT_FOUND');
 expect(await asApp(other,async c=>(await c.query('SELECT * FROM member_credit_quota WHERE org_id=$1',[org])).rows)).toEqual([]);
 await expect(asApp(other,c=>c.query('UPDATE member_credit_quota SET monthly_limit=9 WHERE org_id=$1',[org]))).resolves.toBeDefined();
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)?.monthlyLimit).toBe(1);
});

it('admits one unbounded voice/multimodal call, holds remaining allowance, and releases it on settlement',async()=>{
 await repo.setCreditQuota(org,user,2,user); // prior tests incurred exactly 1 Credit
 const unbounded=(id:string)=>db.withTenant(org,s=>store.reserveInSession(s,org,{...start(id),maximumTokens:null}));
 const results=await Promise.allSettled([unbounded('voice'),unbounded('multimodal')]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const id=results[0]!.status==='fulfilled'?'voice':'multimodal';
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:1,heldCredits:1});
 await expect(reserve('parallel',1)).rejects.toMatchObject({code:'credit_required',ownerType:'user'});
 await settle(id,0);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:1,heldCredits:0});
 await unbounded('voice-cap');
 // A provider reports incurred cost after consumption; preserve the receipt even if it crosses the cap.
 await settle('voice-cap',1100);
 await expect(db.withTenant(org,s=>assertMemberCreditContinuation(s,org,user,`${prefix}-voice-cap`))).rejects.toMatchObject({code:'credit_required',reason:'member_monthly_limit'});
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:2.1,heldCredits:0});
 await expect(unbounded('exhausted')).rejects.toMatchObject({code:'credit_required',ownerType:'user'});
 await repo.setCreditQuota(org,user,0,user);await expect(unbounded('disabled')).rejects.toMatchObject({code:'credit_required',ownerType:'user'});
});

it('unconfigured and personal-local workspaces use funded personal Credit',async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=3000 WHERE owner_type='user' AND owner_id=$1",[user]));
 await asApp(other,c=>c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[other,user]));
 const personal=toOrgId(`${prefix}-personal`);await seedOrg({orgId:personal,kind:'personal-local',ownerUserId:user,projectId:`${personal}-project`});
 await asApp(personal,async c=>{
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[personal,user]);
  // Stale subscription metadata must not override the canonical personal-local boundary.
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'enterprise',1,$2)",[personal,user]);
 });
 for(const [context,suffix] of [[other,'unconfigured-unrestricted'],[personal,'personal-unrestricted']] as const){
  expect(await repo.readCreditQuotas(context)).toMatchObject({enterprise:false,members:[]});
  await expect(repo.setCreditQuota(context,user,1,user)).rejects.toBeInstanceOf(EnterpriseCreditPlanRequired);
  await expect(db.withTenant(context,s=>store.reserveInSession(s,context,start(suffix,2000000)))).resolves.toBeUndefined();
  await db.withTenant(context,s=>store.settleInSession(s,context,{eventId:`${prefix}-${suffix}`,userId:user,runId:null,modelProvider:'test',modelId:'test',tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:'reported',outcome:'succeeded'}));
 }
});
it('paid non-enterprise Team uses one exclusive unknown-cost personal reservation',async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=3000 WHERE owner_type='user' AND owner_id=$1",[user]));
 const priorEpoch=await asOwner(async c=>(await c.query('SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton')).rows[0]);
 await asOwner(c=>c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton',[generation]));
 try{
  const team=toOrgId(`${prefix}-paid-team`),at=new Date();
  await seedOrg({orgId:team,projectId:`${team}-project`});
  await asApp(team,c=>c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[team,user]));
  const quoteRef=`quote-${randomUUID()}`,quote={orgId:team,generation,quoteRef,catalogVersion:'frozen',sku:'team-year',provider:'wechat',currency:'CNY',amountMinor:12345,createdAt:at.toISOString(),expiresAt:new Date(at.getTime()+300000).toISOString(),purpose:'initial',seats:5,monthlyCredits:100000,billingCycle:'year',renewalMode:'manual',planVersion:0};
  await asOwner(c=>c.query('INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[quoteRef,team,generation,quote,at,quote.expiresAt]));
  const purchase=await new PgTeamCheckoutRepository(db,{authorize:async()=>team} as never,()=>true,()=>at).reserve({orgId:team,userId:user},team,{quoteRef,idempotencyKey:`paid-${randomUUID()}`});
  await new PgTeamPaymentRepository(db,()=>at).settle(team,{provider:'wechat',purchaseRef:purchase.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll('-','')}`,amountMinor:12345,currency:'CNY',paidAt:at});
  expect(await asApp(team,async c=>(await c.query('SELECT plan FROM organization_plans WHERE org_id=$1',[team])).rows[0].plan)).toBe('ordinary');
  expect(await repo.readCreditQuotas(team)).toMatchObject({enterprise:false,members:[]});
  await expect(repo.setCreditQuota(team,user,1,user)).rejects.toBeInstanceOf(EnterpriseCreditPlanRequired);
  await expect(db.withTenant(team,s=>store.reserveInSession(s,team,start('paid-team-unrestricted',2000000)))).resolves.toBeUndefined();
  await db.withTenant(team,s=>store.settleInSession(s,team,{eventId:`${prefix}-paid-team-unrestricted`,userId:user,runId:null,modelProvider:'test',modelId:'test',tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:'reported',outcome:'succeeded'}));
  const unknown=await Promise.allSettled(['unknown-a','unknown-b'].map(id=>db.withTenant(team,s=>store.reserveInSession(s,team,{...start(id),maximumTokens:null}))));
  expect(unknown.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const admitted=unknown[0]!.status==='fulfilled'?'unknown-a':'unknown-b';
  for(const id of [admitted])await db.withTenant(team,s=>store.settleInSession(s,team,{eventId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'test',modelId:'test',tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:'reported',outcome:'succeeded'}));
 }finally{
  await asOwner(c=>c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton',[priorEpoch.generation,priorEpoch.activated_at]));
 }
});

it('requires the current canonical Enterprise generation before showing or editing member limits',async()=>{
 const stale=toOrgId(`${prefix}-stale`);await seedOrg({orgId:stale,projectId:`${stale}-project`});
 await asApp(stale,async c=>{
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[stale,user]);
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'enterprise',1,$2)",[stale,user]);
 });
 for(const billingGeneration of [null,'stale-generation']){
  await asApp(stale,c=>c.query('UPDATE organization_plans SET billing_generation=$2 WHERE org_id=$1',[stale,billingGeneration]));
  expect(await repo.readCreditQuotas(stale)).toMatchObject({enterprise:false,members:[]});
  await expect(repo.setCreditQuota(stale,user,0,user)).rejects.toBeInstanceOf(EnterpriseCreditPlanRequired);
 }
 await asApp(stale,c=>c.query('UPDATE organization_plans SET billing_generation=$2 WHERE org_id=$1',[stale,generation]));
 expect((await repo.readCreditQuotas(stale)).members[0]).toMatchObject({monthlyLimit:5000,overridden:false});
 await repo.setCreditQuota(stale,user,0,user);
 expect((await repo.readCreditQuotas(stale)).members[0]).toMatchObject({monthlyLimit:0,overridden:true});
});
