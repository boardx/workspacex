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
const start=(id:string,tokens=1000)=>({requestId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'test',modelId:'test',startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,maximumTokens:tokens});
const reserve=(id:string,tokens=1000)=>db.withTenant(org,s=>store.reserveInSession(s,org,start(id,tokens)));
const settle=(id:string,tokens:number)=>db.withTenant(org,s=>store.settleInSession(s,org,{eventId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'test',modelId:'test',tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:'reported',outcome:'succeeded'}));
// @global-scope-fixture table:credit_transactions: immutable exact prefix fixture debit rows retained in disposable DB.
// @global-scope-fixture table:credentials: exact prefix user retained in disposable DB, no unrelated user reads or writes.
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:`${prefix}-project`});await seedOrg({orgId:other,projectId:`${prefix}-other-project`});
 await asApp(org,async c=>{
  await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'Credit member','$2b$12$test-fixture-already-hashed')",[user,`${user}@example.test`]);
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[org,user]);
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'enterprise',1,$2)",[org,user]);
 });
},180000);
afterAll(async()=>{await db.close();console.info('[member-credit-fixture-retention]',JSON.stringify({org,other,user}));});
it('defaults existing members without writing quota or wallet funds; applies to new members',async()=>{
 const first=await repo.readCreditQuotas(org);expect(first.members[0]).toMatchObject({monthlyLimit:1000,overridden:false,usedCredits:0});
 expect(await asApp(org,async c=>(await c.query('SELECT count(*)::int AS n FROM member_credit_quota WHERE org_id=$1',[org])).rows[0].n)).toBe(0);
 expect(await asApp(org,async c=>(await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].n)).toBe(0);
 const newcomer=`${prefix}-new`;await asApp(org,async c=>{
  await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'New member','$2b$12$test-fixture-already-hashed')",[newcomer,`${newcomer}@example.test`]);
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'consultant')",[org,newcomer]);
 });expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===newcomer)).toMatchObject({monthlyLimit:1000,overridden:false});
 const guest=`${prefix}-guest`;
 await asApp(org,c=>c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'consultant')",[org,guest]));
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===guest)).toMatchObject({displayName:guest,email:'',monthlyLimit:1000,overridden:false});
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
 await expect(reserve('parallel',1)).rejects.toMatchObject({reason:'member_monthly_limit'});
 await settle(id,0);
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:1,heldCredits:0});
 await unbounded('voice-cap');
 // A provider reports incurred cost after consumption; preserve the receipt even if it crosses the cap.
 await settle('voice-cap',1100);
 await expect(db.withTenant(org,s=>assertMemberCreditContinuation(s,org,user,`${prefix}-voice-cap`))).rejects.toMatchObject({code:'credit_required',reason:'member_monthly_limit'});
 expect((await repo.readCreditQuotas(org)).members.find(m=>m.userId===user)).toMatchObject({usedCredits:2.1,heldCredits:0});
 await expect(unbounded('exhausted')).rejects.toMatchObject({reason:'member_monthly_limit'});
 await repo.setCreditQuota(org,user,0,user);await expect(unbounded('disabled')).rejects.toMatchObject({reason:'member_monthly_limit'});
});
