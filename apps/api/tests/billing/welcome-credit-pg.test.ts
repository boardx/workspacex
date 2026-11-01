import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resetOrgsOwnedBy } from "../support/auth-db";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { ensureDatabase, migrateOnce, seedOrg, asApp, asOwner } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgBillingWalletRepository } from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import { readWelcomeCreditGrant } from "../../src/infrastructure/billing/welcome-credit-periods";
import { PgPersonalCreditScheduleStore } from "../../src/infrastructure/billing/pg-personal-credit-schedule-store";
import { PgCreditConsumption } from "../../src/infrastructure/billing/pg-credit-consumption";
import { grantPaidSubscriptionPeriod, normalizeCreditPeriods } from "../../src/infrastructure/billing/pg-credit-periods";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { toOrgId } from "../../src/domain/org-id";
const prefix=`welcome-${randomUUID().slice(0,10)}`, db=new PgDatabase(appConfig()), users:string[]=[];
const hash="$2b$12$test-fixture-already-hashed";
// Epoch fixture ownership: dedicated isolated database; afterAll restores inactive marker.
// @global-scope-fixture table:credentials: afterAll deletes this file's exact recorded user IDs.
// Wallet fixture ownership: afterAll deletes only exact recorded user IDs.
beforeAll(async()=>{
  ensureDatabase();await migrateOnce();
  const initial=await asOwner(async c=>(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0]);
  expect(initial).toEqual({generation:null,activated_at:null});
  await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
});
afterAll(async()=>{
  await asOwner(async c=>{
    await c.query("DELETE FROM credit_consumption_requests WHERE user_id=ANY($1::text[])",[users]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[users]);
    await c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[])",[users]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  });await resetOrgsOwnedBy(users);await db.close();
});
async function account(suffix:string,createdAt?:Date){
  const userId=`${prefix}-${suffix}`,org=toOrgId(userId);users.push(userId);
  await seedOrg({orgId:org,kind:"personal-local",ownerUserId:userId,projectId:`${org}-project`});
  await asApp(org,c=>c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,created_at) VALUES($1,$2,$3,$4,COALESCE($5,now()))",[userId,`${userId}@welcome.test`,suffix,hash,createdAt??null]));
  await asApp(org,c=>c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin')",[userId,org]));
  const wallet=()=>new PgBillingWalletRepository(db).wallet({orgId:org,ownerType:"user",ownerId:userId});
  const periods=()=>asApp(org,async c=>(await c.query("SELECT * FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$1",[userId])).rows);
  return {userId,org,wallet,periods};
}
it("does not gift while inactive and never backfills an existing account after activation",async()=>{
  await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  const f=await account("stock");expect(await f.periods()).toEqual([]);
  await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
  await f.wallet();await f.wallet();
  await asApp(f.org,c=>c.query("UPDATE credentials SET updated_at=now() WHERE user_id=$1",[f.userId]));
  expect(await f.periods()).toEqual([]);
});
it("gifts a real new credential exactly 1000 with 30-day expiry, independently of paid quota",async()=>{
  const f=await account("new"),rows=await f.periods();expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({source_kind:"welcome",granted_hundredths:"100000",remaining_hundredths:"100000"});
  expect(rows[0].period_end.getTime()-rows[0].period_start.getTime()).toBe(30*86400000);
  expect((await f.wallet()).wallet).toMatchObject({balance:1000,permanentBalance:0,subscriptionCredits:0,totalGranted:1000});
});
it("expires the welcome source once while retaining a permanent balance",async()=>{
  const f=await account("expiry"),[period]=await f.periods();
  await asApp(f.org,c=>c.query("UPDATE credit_wallets SET balance=balance+7 WHERE owner_type='user' AND owner_id=$1",[f.userId]));
  const at=new Date(period.period_end.getTime());
  const expire=()=>db.withTenant(f.org,async s=>{await s.query("SELECT wallet_id FROM credit_wallets WHERE wallet_id=$1 FOR UPDATE",[period.wallet_id]);await normalizeCreditPeriods(s,period.wallet_id,at);});
  await Promise.all([expire(),expire()]);
  expect((await f.wallet()).wallet).toMatchObject({balance:7,permanentBalance:7,subscriptionCredits:0});
  const ledger=await asApp(f.org,async c=>(await c.query("SELECT type,direction,credits::text,source_type FROM credit_transactions WHERE wallet_id=$1 ORDER BY created_at,txn_id",[period.wallet_id])).rows);
  expect(ledger).toEqual([{type:"welcome_grant",direction:1,credits:"1000.00",source_type:"welcome_period"},{type:"welcome_expire",direction:-1,credits:"1000.00",source_type:"welcome_period"}]);
});
it("application cannot activate the gift campaign",async()=>{
  const definer=await asOwner(async c=>(await c.query("SELECT prosecdef FROM pg_proc WHERE oid='billing_new_account_welcome()'::regprocedure")).rows[0].prosecdef);
  expect(definer).toBe(false);
  const f=await account("no-activation");
  await expect(asApp(f.org,c=>c.query("UPDATE billing_pricing_epoch SET activated_at=now() WHERE singleton=true"))).rejects.toThrow(/permission denied/);
});

it("reads real welcome facts and never revives a terminal expired batch",async()=>{
  const f=await account("read");
  const read=(at?:Date)=>db.withTenant(f.org,s=>readWelcomeCreditGrant(s,f.userId,at));
  const first=await read();expect(first.status).toBe("granted");expect(first.grant).toMatchObject({credits:1000,remainingCredits:1000});
  const at=new Date(first.grant!.expiresAt);
  expect(await read(at)).toMatchObject({status:"expired",grant:{remainingCredits:0}});
  expect(await read(at)).toMatchObject({status:"expired",grant:{remainingCredits:0}});
  expect((await f.wallet()).wallet.balance).toBe(0);
});
it("does not disguise an eligible missing gift as none",async()=>{
  const f=await account("missing");
  await asOwner(c=>c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1 AND owner_type='user')",[f.userId]));
  await expect(db.withTenant(f.org,s=>readWelcomeCreditGrant(s,f.userId))).rejects.toThrow("welcome_grant_missing");
});
it("background expiry reaches welcome-only wallets without a paid term",async()=>{
  const f=await account("sweep");
  await asOwner(c=>c.query("UPDATE credit_subscription_periods SET period_start=statement_timestamp()-interval '31 days',period_end=statement_timestamp()-interval '1 day' WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1 AND owner_type='user')",[f.userId]));
  await new PgPersonalCreditScheduleStore(db,{info:vi.fn(),error:vi.fn()}).reconcileDue(null);
  const balance=await asApp(f.org,async c=>(await c.query("SELECT balance::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[f.userId])).rows[0].balance);
  expect(balance).toBe("0.00");
});

function registration(suffix:string,email?:string){
  const userId=`${prefix}-reg-${suffix}`;users.push(userId);
  return {userId,email:email??`${userId}@welcome.test`,displayName:suffix,passwordHash:hash,orgId:toOrgId(`${userId}-org`),orgName:"Welcome test",
    verificationChallengeId:randomUUID(),verificationTokenDigest:randomBytes(32).toString("hex"),verificationOutboxId:randomUUID(),verificationExpiresAt:new Date(Date.now()+86400000)};
}
it("a failed real registration transaction rolls back its credential and welcome wallet together",async()=>{
  const input=registration("rollback");
  const failing:DatabasePort={
    withTenant:(org,fn)=>db.withTenant(org,s=>fn({query(sql,params){if(/\bINSERT\s+INTO\s+mail_outbox\b/.test(sql))throw Error("outbox-injected");return s.query(sql,params);}})),
    withoutTenant:fn=>db.withoutTenant(fn),close:async()=>undefined,
  };
  await expect(new PgRegistrationRepository(failing).createAccountAndOrg(input)).rejects.toThrow("outbox-injected");
  const counts=await asOwner(async c=>(await c.query("SELECT (SELECT count(*)::int FROM credentials WHERE user_id=$1) AS credentials,(SELECT count(*)::int FROM credit_wallets WHERE owner_type='user' AND owner_id=$1) AS wallets,(SELECT count(*)::int FROM organizations WHERE id=$2 OR owner_user_id=$1) AS orgs",[input.userId,input.orgId])).rows[0]);
  expect(counts).toEqual({credentials:0,wallets:0,orgs:0});
});
it("concurrent duplicate registration creates only one account and one gift",async()=>{
  const a=registration("race-a"),b=registration("race-b",a.email),repo=new PgRegistrationRepository(db);
  const results=await Promise.all([repo.createAccountAndOrg(a),repo.createAccountAndOrg(b)]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toHaveLength(1);
  const rows=await asOwner(async c=>(await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[[a.userId,b.userId]])).rows);
  expect(rows).toEqual([{balance:"1000.00",total_granted:1000}]);
});

async function consume(f:Awaited<ReturnType<typeof account>>,tokens:number){
  const meter=new PgCreditConsumption(db),id=`${f.userId}-${randomUUID()}`;
  await db.withTenant(f.org,s=>meter.reserveInSession(s,f.org,{requestId:id,userId:f.userId,runId:null,modelProvider:"test",modelId:"welcome-test",executionAttemptId:null,projectId:null,startedAt:new Date().toISOString(),maximumTokens:tokens}));
  await db.withTenant(f.org,s=>meter.settleInSession(s,f.org,{eventId:id,userId:f.userId,runId:null,modelProvider:"test",modelId:"welcome-test",tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:"reported",outcome:"succeeded"}));
}
it("welcome consumption can overdraw an admitted request and expiry preserves the debt",async()=>{
  const f=await account("debt");await consume(f,1005000);
  expect((await f.wallet()).wallet).toMatchObject({balance:-5,permanentBalance:-5,subscriptionCredits:0});
  const [period]=await f.periods();
  expect(await db.withTenant(f.org,s=>readWelcomeCreditGrant(s,f.userId,period.period_end))).toMatchObject({status:"expired",grant:{remainingCredits:0}});
  expect((await f.wallet()).wallet.balance).toBe(-5);
});
it("welcome and paid batches share one debit and expire independently",async()=>{
  const f=await account("mixed"),[welcome]=await f.periods(),start=new Date(),end=new Date(start.getTime()+31*86400000);
  // Synthetic authenticated monthly-invoice fixture; no online provider payment is claimed.
  await db.withTenant(f.org,s=>grantPaidSubscriptionPeriod(s,{userId:f.userId,subscriptionRef:`sub_${f.userId}`,invoiceRef:`in_${f.userId}`,planRef:"price_monthly",periodStart:start,periodEnd:end}));
  expect((await f.wallet()).wallet).toMatchObject({balance:21000,permanentBalance:0,subscriptionCredits:20000});
  await consume(f,500000);
  expect(await db.withTenant(f.org,s=>readWelcomeCreditGrant(s,f.userId))).toMatchObject({status:"granted",grant:{remainingCredits:500}});
  await db.withTenant(f.org,s=>readWelcomeCreditGrant(s,f.userId,welcome.period_end));
  expect((await f.wallet()).wallet).toMatchObject({balance:20000,permanentBalance:0,subscriptionCredits:20000});
  await db.withTenant(f.org,async s=>{await s.query("SELECT wallet_id FROM credit_wallets WHERE wallet_id=$1 FOR UPDATE",[welcome.wallet_id]);await normalizeCreditPeriods(s,welcome.wallet_id,end);});
  expect((await f.wallet()).wallet).toMatchObject({balance:0,permanentBalance:0,subscriptionCredits:0});
});

it("replays the generated migration without resetting activation or paying existing users twice",async()=>{
  const f=await account("migration"),before=(await f.wallet()).wallet;
  const sql=readFileSync(new URL("../../migrations/20261102000000_welcome_credit_periods.sql",import.meta.url),"utf8");
  await asOwner(async c=>{await c.query("BEGIN");try{
    const epoch=(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0];
    await c.query(sql);await c.query(sql);
    expect((await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0]).toEqual(epoch);
  }finally{await c.query("ROLLBACK");}});
  expect((await f.wallet()).wallet).toEqual(before);expect(await f.periods()).toHaveLength(1);
});
