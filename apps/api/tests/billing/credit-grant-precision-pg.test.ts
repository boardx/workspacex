import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,asApp,asOwner,resetOrgs} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgBillingWalletRepository} from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import {grantPaidSubscriptionPeriod} from "../../src/infrastructure/billing/pg-credit-periods";
import {BILLING_ACCOUNTING_GENERATION} from "../../src/domain/billing/billing-generation";
import {toOrgId} from "../../src/domain/org-id";
const prefix=`grant-precision-${randomUUID().slice(0,10)}`,users:string[]=[],db=new PgDatabase(appConfig());
// @global-scope-fixture table:credit_wallets: exact recorded fixture owner IDs are removed afterAll.
// @global-scope-fixture table:credit_transactions: afterAll removes only ledger rows for this file's exact recorded wallet owner IDs.
// @global-scope-fixture table:credentials: only the exact credential created by this file is removed.
// Own isolated epoch fixture; restore inactive marker afterAll.
beforeAll(async()=>{ensureDatabase();await migrateOnce();await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));},180000);
afterAll(async()=>{
 await asOwner(async c=>{
  const wallets="SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[])";
  await c.query(`DELETE FROM credit_subscription_periods WHERE wallet_id IN (${wallets})`,[users]);
  await c.query(`DELETE FROM credit_transactions WHERE wallet_id IN (${wallets})`,[users]);
  await c.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])",[users]);
  await c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[])",[users]);
  await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
 });await resetOrgs(users);await db.close();
});
async function fixture(suffix:string,total="100000.25",balance=total,ownerType:"user"|"team"="user"){
 const userId=`${prefix}-${suffix}`,org=toOrgId(userId);users.push(userId);
 await seedOrg({orgId:org,kind:ownerType==="user"?"personal-local":"organization",ownerUserId:ownerType==="user"?userId:undefined,projectId:`${userId}-project`});
 const walletId=await asApp(org,async c=>{
  await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[org,userId]);
  return(await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_granted) VALUES($1,$2,$3::numeric,$4::numeric) RETURNING wallet_id",[ownerType,userId,balance,total])).rows[0].wallet_id as string;
 });
 const raw=()=>asApp(org,async c=>(await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE wallet_id=$1",[walletId])).rows[0]);
 const wallet=()=>new PgBillingWalletRepository(db).wallet({orgId:org,ownerType,ownerId:userId});
 const start=new Date(Date.now()-86400000),end=new Date(start.getTime()+30*86400000);
 const input={userId,subscriptionRef:`sub-${userId}`,invoiceRef:`invoice-${userId}`,planRef:"precision-monthly",periodStart:start,periodEnd:end};
 const grant=()=>db.withTenant(org,s=>grantPaidSubscriptionPeriod(s,input));
 return {userId,org,walletId,raw,wallet,grant};
}
it.each(["user","team"] as const)("stores and exposes hundredth cumulative grants for %s wallets",async ownerType=>{
 const f=await fixture(`read-${ownerType}`,"100000.25","100000.25",ownerType);
 expect(await f.raw()).toEqual({balance:"100000.25",total_granted:"100000.25"});
 expect((await f.wallet()).wallet).toMatchObject({balance:100000.25,totalGranted:100000.25});
});
it("atomically accumulates independent hundredth increments without losing cents",async()=>{
 const f=await fixture("concurrent");
 const add=(key:string)=>db.withTenant(f.org,async s=>{
  const row=(await s.query<{balance:string}>("UPDATE credit_wallets SET balance=balance+0.01,total_granted=total_granted+0.01 WHERE wallet_id=$1 RETURNING balance::text",[f.walletId])).rows[0]!;
  await s.query("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason) VALUES($1,'grant',1,0.01,$2,'admin_grant',$3,'precision-fixture','concurrent database precision')",[f.walletId,row.balance,key]);
 });
 await Promise.all([add(`${f.userId}-a`),add(`${f.userId}-b`)]);
 expect(await f.raw()).toEqual({balance:"100000.27",total_granted:"100000.27"});
 const ledger=await asApp(f.org,async c=>(await c.query("SELECT sum(credits)::text AS credits,count(*)::int AS n FROM credit_transactions WHERE wallet_id=$1",[f.walletId])).rows[0]);
 expect(ledger).toEqual({credits:"0.02",n:2});
});
it("keeps the fractional counter through real monthly grant and duplicate delivery",async()=>{
 const f=await fixture("monthly","0.25");
 expect(await f.grant()).toBe("granted");expect(await f.grant()).toBe("duplicate");
 expect(await f.raw()).toEqual({balance:"20000.25",total_granted:"20000.25"});
 expect((await f.wallet()).wallet.totalGranted).toBe(20000.25);
});
it("rejects lifetime-counter overflow before inserting a period and rolls back all writes",async()=>{
 const f=await fixture("overflow","2147480000.25","0.25"),before=await f.raw();
 await expect(f.grant()).rejects.toThrow("credit_balance_unrepresentable");
 expect(await f.raw()).toEqual(before);
 const rows=await asApp(f.org,async c=>(await c.query("SELECT (SELECT count(*)::int FROM credit_subscription_periods WHERE wallet_id=$1) AS periods,(SELECT count(*)::int FROM credit_transactions WHERE wallet_id=$1) AS ledger",[f.walletId])).rows[0]);
 expect(rows).toEqual({periods:0,ledger:0});
});
it("preserves existing hundredths when the actual new-account gift trigger runs",async()=>{
 const f=await fixture("welcome","0.25");
 await asApp(f.org,c=>c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'Precision fixture','$2b$12$test-fixture-already-hashed')",[f.userId,`${f.userId}@precision.test`]));
 expect(await f.raw()).toEqual({balance:"1000.25",total_granted:"1000.25"});
 expect((await f.wallet()).wallet.totalGranted).toBe(1000.25);
 const gifts=await asApp(f.org,async c=>(await c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE wallet_id=$1 AND type='welcome_grant'",[f.walletId])).rows[0]);
 expect(gifts).toEqual({n:1});
});
it.each(["-0.01","2147483647.01"])("enforces the nonnegative original counter bound for %s",async total=>{
 const f=await fixture(total.startsWith("-")?"bounds-negative":"bounds-overflow","0","0");
 await expect(asApp(f.org,c=>c.query("UPDATE credit_wallets SET total_granted=$2::numeric WHERE wallet_id=$1",[f.walletId,total]))).rejects.toMatchObject({code:"23514"});
 expect(await f.raw()).toEqual({balance:"0.00",total_granted:"0.00"});
});
