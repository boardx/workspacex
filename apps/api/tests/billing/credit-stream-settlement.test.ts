import {afterAll, beforeAll, expect, it} from "vitest";
import {randomUUID} from "node:crypto";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ensureDatabase, migrateOnce, seedOrg, asApp, asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {DurableCreditUsageMeter} from "../../src/infrastructure/billing/durable-credit-usage";
import {toOrgId} from "../../src/domain/org-id";

const org = toOrgId(`cstream-${randomUUID().slice(0, 12)}`), user = `${org}-user`;
const other = toOrgId(`${org}-other`);
const db = new PgDatabase(appConfig()), credits = new PgCreditConsumption(db);
const prefix = `${org}:`;
// @global-scope-fixture table:credit_wallets: this file mutates only its exact enterprise wallet, then removes it.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({orgId: org, projectId: `${org}-project`});
  await seedOrg({orgId: other, projectId: `${other}-project`});
  await asApp(org, async c => {
    await c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin')", [user, org]);
    await c.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('team',$1)", [org]);
  });
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM credit_consumption_requests WHERE org_id=$1", [org]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)", [org]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1", [org]);
  }); await db.close();
});
const start = (id: string) => ({requestId: prefix + id, userId: user, runId: null, modelProvider: "test", modelId: "stream-model", callPurpose: "auxiliary" as const, startedAt: new Date().toISOString(), executionAttemptId: null, projectId: null, maximumTokens: 1000});
const receipt = (id: string, receiptId: string, tokens: number, final = false) => ({eventId: prefix + id, userId: user, runId: null,
  modelProvider: "test", modelId: "stream-model", callPurpose: "auxiliary" as const, tokensTotal: tokens, promptTokens: tokens, completionTokens: 0, totalSource: "reported" as const, outcome: "succeeded" as const,
  billingReceipt: {id: receiptId, final}});
const record = (id: string, receiptId: string, tokens: number, final = false) => db.withTenant(org, s => credits.settleInSession(s, org, receipt(id, receiptId, tokens, final)));
const debit = (id: string) => asApp(org, async c => (await c.query("SELECT debited_hundredths::text AS debit,state FROM credit_consumption_requests WHERE request_id=$1", [prefix + id])).rows[0]);

it("rounds cumulative stream usage once, ignores stale snapshots, and releases the hold only at completion", async () => {
  await db.withTenant(org, s => credits.reserveInSession(s, org, start("cumulative")));
  await record("cumulative", "chunk-1", 1);
  expect(await debit("cumulative")).toMatchObject({debit: "1"});
  await record("cumulative", "chunk-2", 10);
  expect(await debit("cumulative")).toMatchObject({debit: "1"});
  await record("cumulative", "chunk-3", 11);
  await record("cumulative", "chunk-1", 1);
  await record("cumulative", "late-chunk-2", 10);
  expect(await debit("cumulative")).toMatchObject({debit: "2"});
  expect(await asApp(org, async c => (await c.query("SELECT held_hundredths::text AS held FROM credit_wallets WHERE owner_id=$1", [org])).rows[0].held)).toBe("100");
  await record("cumulative", "final", 11, true);
  await record("cumulative", "final", 11, true);
  expect(await debit("cumulative")).toMatchObject({debit: "2", state: "settled"});
  expect(await asApp(org, async c => (await c.query("SELECT held_hundredths::text AS held FROM credit_wallets WHERE owner_id=$1", [org])).rows[0].held)).toBe("0");
  await expect(record("cumulative", "chunk-3", 12)).rejects.toThrow("credit_receipt_replay_mismatch");
  await expect(record("cumulative", "conflicting-final", 12, true)).rejects.toThrow("credit_receipt_replay_mismatch");
});
it("writes the sole token-usage event at stream completion rather than counting every cumulative snapshot", async () => {
  const meter = new PgTokenUsageRepository(db);
  await meter.startRequest(org, start("token-events"));
  await meter.record(org, receipt("token-events", "chunk", 10));
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS count FROM token_usage_events WHERE org_id=$1 AND id=$2", [org, prefix + "token-events"])).rows[0].count)).toBe(0);
  await meter.record(org, receipt("token-events", "final", 11, true));
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS count,sum(tokens_total)::text AS tokens FROM token_usage_events WHERE org_id=$1 AND id=$2", [org, prefix + "token-events"])).rows[0])).toEqual({count: 1, tokens: "11"});
});
it("isolates financial receipts by tenant and rejects a forged actor even on a known receipt replay", async () => {
  const id="tenant-boundary";
  await db.withTenant(org,s=>credits.reserveInSession(s,org,start(id)));
  await record(id,"first",1);
  expect(await asApp(other,async c=>(await c.query("SELECT receipt_id FROM credit_consumption_receipts WHERE request_id=$1",[prefix+id])).rows)).toEqual([]);
  await expect(db.withTenant(org,s=>credits.settleInSession(s,org,{...receipt(id,"first",1),userId:"forged-user"}))).rejects.toThrow("credit_receipt_provenance_mismatch");
  await expect(asApp(other,c=>c.query("INSERT INTO credit_consumption_receipts(request_id,org_id,receipt_id,terminal,usage_facts,debited_hundredths) VALUES($1,$2,'forged',false,'{}'::jsonb,0)",[prefix+id,other]))).rejects.toThrow(/foreign key/);
  await record(id,"final",1,true);
});
it("recovers cumulative receipts after a database outage without adding per-chunk rounding or another dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "credit-stream-test-"));
  let offline = false, starts = 0;
  const delegate = {startRequest: async (_org: typeof org, input: ReturnType<typeof start>) => {starts++; await db.withTenant(org, s => credits.reserveInSession(s, org, input));},
    record: async (_org: typeof org, input: ReturnType<typeof receipt>) => {if (offline) throw new Error("offline"); await db.withTenant(org, s => credits.settleInSession(s, org, input));}};
  try {
    const meter = new DurableCreditUsageMeter(delegate, {directory});
    await meter.startRequest(org, start("outage"));
    await meter.record(org, receipt("outage", "one", 1));
    offline = true;
    await expect(meter.record(org, receipt("outage", "two", 10))).rejects.toThrow("offline");
    await expect(meter.record(org, receipt("outage", "final", 11, true))).rejects.toThrow("offline");
    offline = false;
    expect(await new DurableCreditUsageMeter(delegate, {directory}).replayPending()).toEqual({settled: 1, pending: 0});
    expect(await debit("outage")).toMatchObject({debit: "2", state: "settled"});
    expect(starts).toBe(1);
  } finally {await rm(directory, {recursive: true, force: true});}
});
