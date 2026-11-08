// @global-scope-fixture table:credentials: the unique welcome replay credential and its grant exist only inside a transaction rolled back in finally.
// @global-scope-fixture table:credit_subscription_periods: historical rows live in a transaction-owned schema rolled back in finally; regular fixture owners keep existing teardown.
// @global-scope-fixture table:credit_transactions: historical invalid writes use savepoint rollback and the entire historical schema rolls back in finally.
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {afterAll, beforeAll, expect, it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase, migrateOnce, seedOrg, asApp, asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgBillingWalletRepository} from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import {toOrgId} from "../../src/domain/org-id";
import {readFileSync} from "node:fs";

const prefix = `cperiod-${randomUUID().slice(0, 12)}`;
const org = toOrgId(prefix);
const db = new PgDatabase(appConfig());
const wallets = new PgBillingWalletRepository(db);
const consumption = new PgCreditConsumption(db);
const owners: string[] = [];
const contexts: string[] = [];
// @global-scope-fixture table:credit_wallets: only this file's recorded exact owners are deleted.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await seedOrg({orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project`});
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])", [[org,...contexts]]);
    if ((await c.query("SELECT to_regclass('credit_subscription_periods') AS relation")).rows[0].relation) {
      await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [owners]);
    }
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [owners]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])", [owners]);
  });
  await db.close();
});
async function fixture(suffix: string, permanent = 7) {
  const relation = await asApp(org, async c => (await c.query("SELECT to_regclass('credit_subscription_periods') AS relation")).rows[0].relation);
  expect(relation, "subscription credit periods must be persisted").not.toBeNull();
  const helpers = await import("../../src/infrastructure/billing/pg-credit-periods");
  const userId = `${prefix}-${suffix}`;
  const context = toOrgId(`${prefix}-${suffix}`);
  owners.push(userId);
  contexts.push(context);
  await seedOrg({orgId: context, kind: "personal-local", ownerUserId: userId, projectId: `${context}-project`});
  await asApp(context, async c => {
    await c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin')", [userId, context]);
    await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,$2)", [userId, permanent]);
  });
  const periodEnd = new Date(Date.now() + 86_400_000);
  const input = {userId, subscriptionRef: `sub_${suffix}`, invoiceRef: `in_${suffix}`, planRef: "price_monthly",
    periodStart: new Date(periodEnd.getTime() - 30 * 86_400_000), periodEnd};
  const wallet = () => wallets.wallet({orgId: context, ownerType: "user", ownerId: userId});
  const grant = () => db.withTenant(context, s => helpers.grantPaidSubscriptionPeriod(s, input));
  const expire = () => db.withTenant(context, async s => {
    const row = (await s.query<{wallet_id: string}>("SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE", [userId])).rows[0]!;
    await helpers.normalizeCreditPeriods(s, row.wallet_id, new Date(periodEnd.getTime() + 1));
  });
  const consume = async (tokens: number) => {
    const id = `${userId}-${randomUUID()}`;
    await db.withTenant(context, s => consumption.reserveInSession(s, context, {requestId: id, userId, runId: null, modelProvider: "test", modelId: "period-model", executionAttemptId: null, projectId: null, startedAt: new Date().toISOString(), maximumTokens: tokens}));
    await db.withTenant(context, s => consumption.settleInSession(s, context, {eventId: id, userId, runId: null, modelProvider: "test", modelId: "period-model", tokensTotal: tokens, promptTokens: tokens, completionTokens: 0, totalSource: "reported", outcome: "succeeded"}));
  };
  return {userId, input, wallet, grant, expire, consume, helpers};
}

it("grants exactly 20000 once under concurrent repeated payment delivery", async () => {
  const f = await fixture("concurrent");
  expect((await Promise.all([f.grant(), f.grant()])).sort()).toEqual(["duplicate", "granted"]);
  expect((await f.wallet()).wallet).toMatchObject({balance: 20007, permanentBalance: 7, subscriptionCredits: 20000});
});
it("expires only unused monthly credits once and preserves permanent funds", async () => {
  const f = await fixture("expiry");
  await f.grant(); await f.consume(19_995_000);
  expect((await f.wallet()).wallet).toMatchObject({balance: 12, permanentBalance: 7, subscriptionCredits: 5});
  await Promise.all([f.expire(), f.expire()]);
  expect((await f.wallet()).wallet).toMatchObject({balance: 7, permanentBalance: 7, subscriptionCredits: 0, subscriptionExpiresAt: null});
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS count FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1 AND t.type='subscription_expire'", [f.userId])).rows[0].count)).toBe(1);
});
it("preserves debt through expiry and a partial recharge", async () => {
  const f = await fixture("debt", 2);
  await f.grant(); await f.consume(20_005_000);
  expect((await f.wallet()).wallet).toMatchObject({balance: -3, permanentBalance: -3, subscriptionCredits: 0, subscriptionExpiresAt: f.input.periodEnd.toISOString()});
  await asApp(org, c => c.query("UPDATE credit_wallets SET balance=balance+2 WHERE owner_type='user' AND owner_id=$1", [f.userId]));
  await f.expire();
  expect((await f.wallet()).wallet).toMatchObject({balance: -1, permanentBalance: -1, subscriptionCredits: 0});
});
it("deduplicates a second invoice for the same subscription period but rejects invoice reassignment", async () => {
  const f = await fixture("sameperiod"); await f.grant();
  expect(await db.withTenant(org, s => f.helpers.grantPaidSubscriptionPeriod(s, {...f.input, invoiceRef: "in_second_for_period"}))).toBe("duplicate");
  const other = await fixture("otherowner");
  await expect(db.withTenant(org, s => f.helpers.grantPaidSubscriptionPeriod(s, {...other.input, invoiceRef: f.input.invoiceRef}))).rejects.toThrow("credit_period_replay_mismatch");
  expect((await other.wallet()).wallet.balance).toBe(7);
});
it("does not revive a past paid period or grant an annual period as monthly", async () => {
  const f = await fixture("past");
  await db.withTenant(org, s => f.helpers.grantPaidSubscriptionPeriod(s, {...f.input, periodStart: new Date(Date.now() - 60 * 86_400_000), periodEnd: new Date(Date.now() - 30 * 86_400_000)}));
  expect((await f.wallet()).wallet).toMatchObject({balance: 7, subscriptionCredits: 0});
  await expect(db.withTenant(org, s => f.helpers.grantPaidSubscriptionPeriod(s, {...f.input, invoiceRef: "in_annual", periodEnd: new Date(f.input.periodStart.getTime() + 365 * 86_400_000)}))).rejects.toThrow("credit_period_invalid");
});
it("replays the new migration without changing existing balances or granting again", async () => {
  const f = await fixture("migration"); await f.grant();
  const before = (await f.wallet()).wallet;
  const sql = readFileSync(new URL("../../migrations/20261030010000_credit_subscription_periods.sql", import.meta.url), "utf8");
  await asOwner(async c => {await c.query("BEGIN"); try {
    await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton",[generation]);
    const credential=`${prefix}-welcome-replay`;
    await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,created_at) VALUES($1,$2,'Replay welcome','$2b$12$test-fixture-already-hashed',clock_timestamp())",[credential,`${credential}@example.test`]);
    expect((await c.query("SELECT type FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1",[credential])).rows.some(row=>row.type==='welcome_grant')).toBe(true);
    const modernWallet=(await c.query("SELECT * FROM public.credit_wallets WHERE owner_type='user' AND owner_id=$1",[credential])).rows;
    const modernPeriods=(await c.query("SELECT * FROM public.credit_subscription_periods WHERE wallet_id=(SELECT wallet_id FROM public.credit_wallets WHERE owner_type='user' AND owner_id=$1)",[credential])).rows;
    const schema=`period_replay_${randomUUID().replaceAll("-","")}`;
    await c.query(`CREATE SCHEMA "${schema}"`);await c.query(`SET LOCAL search_path TO "${schema}",public`);
    const core=readFileSync(new URL("../../migrations/20261001090000_billing_credits_core.sql",import.meta.url),"utf8");
    const precision=readFileSync(new URL("../../migrations/20261022120000_credit_consumption.sql",import.meta.url),"utf8");
    await c.query(core);await c.query(precision);await c.query(sql);
    const wallet=(await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user','historical',37) RETURNING wallet_id")).rows[0].wallet_id;
    await c.query("INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths) VALUES($1,'s','i','p',now(),now()+interval '30 days',100,80)",[wallet]);
    const historical=async()=>({wallets:(await c.query("SELECT * FROM credit_wallets")).rows,periods:(await c.query("SELECT * FROM credit_subscription_periods")).rows});
    const snapshot=await historical();
    await c.query(core);await c.query(precision);await c.query(sql);
    expect(await historical()).toEqual(snapshot);
    const reject=async(statement:string,args:unknown[]=[])=>{await c.query("SAVEPOINT invalid_probe");try{await expect(c.query(statement,args)).rejects.toMatchObject({code:'23514'});}finally{await c.query("ROLLBACK TO SAVEPOINT invalid_probe");}};
    await reject("INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths) VALUES($1,'bad','bad','p',now(),now()-interval '1 day',100,80)",[wallet]);
    await reject("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'invalid',1,1,37,'payment_order','bad')",[wallet]);
    await reject("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'subscription_grant',-1,1,37,'subscription_period','bad')",[wallet]);
    await reject("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'subscription_grant',1,1,37,'admin_grant','bad-source')",[wallet]);
    await reject("INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths) VALUES($1,'over','over','p',now(),now()+interval '1 day',100,101)",[wallet]);
    expect((await c.query("SELECT * FROM public.credit_wallets WHERE owner_type='user' AND owner_id=$1",[credential])).rows).toEqual(modernWallet);
    expect((await c.query("SELECT * FROM public.credit_subscription_periods WHERE wallet_id=(SELECT wallet_id FROM public.credit_wallets WHERE owner_type='user' AND owner_id=$1)",[credential])).rows).toEqual(modernPeriods);
  } finally {await c.query("ROLLBACK");}});
  expect((await f.wallet()).wallet).toEqual(before);
});
