import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, asOwner, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { recordPaidPersonalTerm, grantDuePersonalTerms } from "../../src/infrastructure/billing/personal-credit-terms";
import { PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { PgPersonalCreditScheduleStore } from "../../src/infrastructure/billing/pg-personal-credit-schedule-store";
import { PgCreditConsumption } from "../../src/infrastructure/billing/pg-credit-consumption";
import { PgBillingWalletRepository } from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import { creditMonthBoundary } from "../../src/domain/billing/personal-credit-calendar";

const prefix = `annual-${randomUUID().slice(0, 12)}`, org = toOrgId(prefix);
const db = new PgDatabase(appConfig()), users: string[] = [];
beforeAll(async () => { ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` }); });
// @global-scope-fixture table:billing_personal_terms: afterAll deletes only the exact recorded user IDs, including pagination fixtures.
// @global-scope-fixture table:credit_wallets: only exact recorded owners of this test are deleted.
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM credit_consumption_requests WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])", [users]);
  }); await db.close();
});
async function fixture(suffix: string, balance = 7) {
  const userId = `${prefix}-${suffix}`; users.push(userId);
  await asApp(org, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,$2)", [userId, balance]));
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const input = { userId, provider: "wechat" as const, paymentRef: `wx_${randomUUID()}`, subscriptionRef: `new_${randomUUID()}`, sku: "pro-cn-year-v1", currency: "CNY", amountMinor: 199000, purchaseAnchor: start, monthOffset: 0, periodStart: start, periodEnd: creditMonthBoundary(start, 12) };
  const record = (value = input) => db.withTenant(org, s => recordPaidPersonalTerm(s, value));
  const sync = () => db.withTenant(org, s => grantDuePersonalTerms(s, userId));
  const wallet = () => asApp(org, async c => (await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId])).rows[0]);
  return { userId, input, record, sync, wallet };
}
it("persists one annual payment but initially grants only one monthly batch under concurrency", async () => {
  const f = await fixture("concurrent"); await Promise.all([f.record(), f.record(), f.sync()]);
  expect(await f.wallet()).toMatchObject({ balance: "20007.00", total_granted: 20000 });
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1", [f.userId])).rows[0].n)).toBe(1);
});
it("rejects mismatched money, currency, period and replay ownership without changing the wallet", async () => {
  const f = await fixture("invalid");
  for (const patch of [{amountMinor: 1}, {currency: "USD"}, {periodEnd: creditMonthBoundary(f.input.periodStart, 1)}]) await expect(f.record({...f.input,...patch})).rejects.toThrow();
  expect(await f.wallet()).toMatchObject({ balance: "7.00", total_granted: 0 });
  await f.record();
  const other = await fixture("other");
  await expect(other.record({...f.input,userId:other.userId})).rejects.toThrow("personal_term_replay_mismatch");
  expect(await other.wallet()).toMatchObject({ balance: "7.00", total_granted: 0 });
});
it("recovers twelve elapsed periods without reviving expired credits or deleting permanent debt", async () => {
  const f = await fixture("late", -3);
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 2); start.setUTCMonth(0, 31); start.setUTCHours(12, 0, 0, 0);
  await f.record({...f.input,purchaseAnchor:start,periodStart:start,periodEnd:creditMonthBoundary(start,12)});
  await Promise.all([f.sync(), f.sync()]);
  expect(await f.wallet()).toMatchObject({ balance: "-3.00", total_granted: 240000 });
  const rows = await asApp(org, async c => (await c.query("SELECT t.type,count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1 GROUP BY t.type ORDER BY t.type", [f.userId])).rows);
  expect(rows).toEqual([{type:"subscription_expire",n:12},{type:"subscription_grant",n:12}]);
});
it("recovers only elapsed months and preserves permanent credits across a repeated late run", async () => {
  const f = await fixture("partial");
  const start = new Date(); start.setUTCMonth(start.getUTCMonth()-3, 1); start.setUTCHours(0,0,0,0);
  await f.record({...f.input,purchaseAnchor:start,periodStart:start,periodEnd:creditMonthBoundary(start,12)});
  await f.sync();
  expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:80000});
});
it("rejects overlapping paid terms and future paid anchors", async () => {
  const f = await fixture("overlap"); await f.record();
  await expect(f.record({...f.input,paymentRef:`wx_${randomUUID()}`})).rejects.toThrow("personal_term_overlap");
  const future = creditMonthBoundary(f.input.periodStart, 2);
  const g = await fixture("future");
  await expect(g.record({...g.input,purchaseAnchor:future,periodStart:future,periodEnd:creditMonthBoundary(future,12)})).rejects.toThrow("personal_term_not_started");
  expect(await g.wallet()).toMatchObject({balance:"7.00",total_granted:0});
});

it("advances across all twelve anchored months with a controlled database clock", async () => {
  const f = await fixture("clock");
  const anchor = new Date("2028-01-31T23:45:01.123Z");
  const input = {...f.input,purchaseAnchor:anchor,periodStart:anchor,periodEnd:creditMonthBoundary(anchor,12)};
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,input,anchor));
  for(let month=0;month<12;month++) {
    const at=creditMonthBoundary(anchor,month);
    await Promise.all([db.withTenant(org,s=>grantDuePersonalTerms(s,f.userId,at)),db.withTenant(org,s=>grantDuePersonalTerms(s,f.userId,at))]);
    expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:(month+1)*20000});
  }
  await db.withTenant(org,s=>grantDuePersonalTerms(s,f.userId,input.periodEnd));
  expect(await f.wallet()).toMatchObject({balance:"7.00",total_granted:240000});
});
it("an authenticated wallet read reconciles a due term without a scheduler tick", async () => {
  const f = await fixture("read");
  const prior=creditMonthBoundary(f.input.periodStart,0); prior.setUTCMonth(prior.getUTCMonth()-1);
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,{...f.input,purchaseAnchor:prior,periodStart:prior,periodEnd:creditMonthBoundary(prior,12)},prior));
  expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:20000});
  const wallet=(await new PgBillingWalletRepository(db).wallet({orgId:org,ownerType:"user",ownerId:f.userId})).wallet;
  expect(wallet).toMatchObject({balance:20007,permanentBalance:7,subscriptionCredits:20000,totalGranted:40000});
});

it("AI admission reconciles a due personal term before deciding whether debt blocks the request", async () => {
  const f=await fixture("admission",-3);
  const prior=new Date(f.input.periodStart); prior.setUTCMonth(prior.getUTCMonth()-1);
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,{...f.input,purchaseAnchor:prior,periodStart:prior,periodEnd:creditMonthBoundary(prior,12)},prior));
  const context=toOrgId(`${prefix}-admission-org`);
  await seedOrg({orgId:context,kind:"personal-local",ownerUserId:f.userId,projectId:`${context}-project`});
  await asApp(context,c=>c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin')",[f.userId,context]));
  await db.withTenant(context,s=>new PgCreditConsumption(db).reserveInSession(s,context,{requestId:`${prefix}-request`,userId:f.userId,runId:null,modelProvider:"test",modelId:"annual-test",executionAttemptId:null,projectId:null,startedAt:new Date().toISOString(),maximumTokens:1000}));
  expect(await f.wallet()).toMatchObject({balance:"19997.00",total_granted:40000});
});
it("a renewed monthly term retains January 31 as its original anchor", async () => {
  const f=await fixture("renewal");
  const anchor=new Date("2028-01-31T12:00:00.000Z");
  const first={...f.input,sku:"pro-cn-month-v1",amountMinor:19900,purchaseAnchor:anchor,monthOffset:0,periodStart:anchor,periodEnd:creditMonthBoundary(anchor,1)};
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,first,anchor));
  const second={...first,paymentRef:`wx_${randomUUID()}`,monthOffset:1,periodStart:creditMonthBoundary(anchor,1),periodEnd:creditMonthBoundary(anchor,2)};
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,second,second.periodStart));
  expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:40000});
  await expect(db.withTenant(org,s=>recordPaidPersonalTerm(s,{...second,paymentRef:`wx_${randomUUID()}`,purchaseAnchor:second.periodStart,monthOffset:0,periodEnd:creditMonthBoundary(second.periodStart,1)},second.periodStart))).rejects.toThrow("personal_term_subscription_mismatch");
});

it("replays the term migration without changing recorded money or granting twice", async () => {
  const f=await fixture("migration"); await f.record();
  const before=await f.wallet();
  const sql=readFileSync(new URL("../../migrations/20261101230000_personal_credit_terms.sql",import.meta.url),"utf8");
  await asOwner(async c=>{await c.query("BEGIN");try{await c.query(sql);await c.query(sql);}finally{await c.query("ROLLBACK");}});
  await f.sync(); expect(await f.wallet()).toEqual(before);
  await expect(asApp(org,c=>c.query("UPDATE billing_personal_terms SET amount_minor=1 WHERE user_id=$1",[f.userId]))).rejects.toThrow(/permission denied/);
});

it("reconciles a fully processed annual term without reentering twelve monthly grants", async () => {
  const f=await fixture("settled-query-count");
  const start=new Date("2024-01-31T12:00:00.000Z");
  await f.record({...f.input,purchaseAnchor:start,periodStart:start,periodEnd:creditMonthBoundary(start,12)});
  const before=await f.wallet(), queries:string[]=[];
  await db.withTenant(org,s=>grantDuePersonalTerms({query(sql,params){queries.push(sql);return s.query(sql,params);}},f.userId));
  expect(await f.wallet()).toEqual(before);
  expect(queries.length).toBeLessThanOrEqual(8);
});

it("does not hide a conflicting existing credit batch when skipping settled windows", async () => {
  const f=await fixture("conflicting-batch"); await f.record();
  const before=await f.wallet();
  await asOwner(c=>c.query("UPDATE credit_subscription_periods SET granted_hundredths=granted_hundredths+100 WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[f.userId]));
  await expect(f.sync()).rejects.toThrow("credit_period_replay_mismatch");
  expect(await f.wallet()).toEqual(before);
});

it("periodic sweep grants a due month while isolating a conflicting account", async () => {
  const good=await fixture("sweep-good"), bad=await fixture("sweep-bad");
  const prior=new Date(good.input.periodStart); prior.setUTCMonth(prior.getUTCMonth()-1);
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,{...good.input,purchaseAnchor:prior,periodStart:prior,periodEnd:creditMonthBoundary(prior,12)},prior));
  await bad.record(); const badBefore=await bad.wallet();
  await asOwner(async c=>{
    await c.query("UPDATE billing_personal_terms SET next_check_at=now() WHERE user_id=$1",[bad.userId]);
    await c.query("UPDATE credit_subscription_periods SET granted_hundredths=granted_hundredths+100 WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[bad.userId]);
  });
  const log={info:vi.fn(),error:vi.fn()};
  const result=await new PgPersonalCreditScheduleStore(db,log).reconcileDue(null);
  expect(result).toMatchObject({processed:1,failed:1,nextCursor:null});
  expect(await good.wallet()).toMatchObject({balance:"20007.00",total_granted:40000});
  expect(await bad.wallet()).toEqual(badBefore);
  expect(log.error).toHaveBeenCalledWith("billing_personal_credit_account_failed",expect.objectContaining({ownerId:bad.userId}));
});
it("a forced early schedule hint cannot release next month's credits", async () => {
  const f=await fixture("early-hint"); await f.record();
  await asOwner(c=>c.query("UPDATE billing_personal_terms SET next_check_at=now() WHERE user_id=$1",[f.userId]));
  await new PgPersonalCreditScheduleStore(db,{info:vi.fn(),error:vi.fn()}).reconcileDue(null);
  expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:20000});
  const next=await asApp(org,async c=>(await c.query("SELECT next_check_at FROM billing_personal_terms WHERE user_id=$1",[f.userId])).rows[0].next_check_at);
  expect(next.getTime()).toBeGreaterThan(Date.now());
});

it("two scheduler instances cannot grant a due monthly window twice", async () => {
  const f=await fixture("multi-worker");
  const prior=new Date(f.input.periodStart); prior.setUTCMonth(prior.getUTCMonth()-1);
  await db.withTenant(org,s=>recordPaidPersonalTerm(s,{...f.input,purchaseAnchor:prior,periodStart:prior,periodEnd:creditMonthBoundary(prior,12)},prior));
  const log={info:vi.fn(),error:vi.fn()};
  await Promise.all([new PgPersonalCreditScheduleStore(db,log).reconcileDue(null),new PgPersonalCreditScheduleStore(db,log).reconcileDue(null)]);
  expect(await f.wallet()).toMatchObject({balance:"20007.00",total_granted:40000});
  const grants=await asApp(org,async c=>(await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1 AND t.type='subscription_grant'",[f.userId])).rows[0].n);
  expect(grants).toBe(2);
});
it("paginates 101 due owners without losing the second batch", async () => {
  const pagePrefix=`${prefix}-zz-page`, ids=Array.from({length:101},(_,i)=>`${pagePrefix}-${String(i).padStart(3,"0")}`);
  users.push(...ids);
  const anchor=new Date(); anchor.setUTCDate(1); anchor.setUTCHours(0,0,0,0);
  await asOwner(c=>c.query(`INSERT INTO billing_personal_terms(user_id,provider,payment_ref,subscription_ref,catalog_version,sku,billing_cycle,currency,amount_minor,purchase_anchor,month_offset,period_start,period_end,next_check_at)
    SELECT id,'wechat','wx_'||id,'pass_'||id,$2,'pro-cn-month-v1','month','CNY',19900,$3,0,$3,$4,now() FROM unnest($1::text[]) AS item(id)`,[ids,PERSONAL_PRICE_CATALOG_VERSION,anchor,creditMonthBoundary(anchor,1)]));
  const store=new PgPersonalCreditScheduleStore(db,{info:vi.fn(),error:vi.fn()});
  const first=await store.reconcileDue(pagePrefix);
  expect(first).toEqual({processed:100,failed:0,nextCursor:ids[99]});
  expect(await store.reconcileDue(first.nextCursor)).toEqual({processed:1,failed:0,nextCursor:null});
  const credited=await asApp(org,async c=>(await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]) AND balance=20000 AND total_granted=20000",[ids])).rows[0].n);
  expect(credited).toBe(101);
});
