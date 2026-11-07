import {afterAll, beforeAll, beforeEach, expect, it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase, migrateOnce, seedOrg, asApp, asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import {PgBillingWalletRepository} from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import {toOrgId, type OrgId} from "../../src/domain/org-id";
import type {TokenUsageRecord} from "../../src/application/agent-run/ports";

const prefix = `cadmit-${randomUUID().slice(0, 10)}`;
const personal = toOrgId(`${prefix}-personal`), enterprise = toOrgId(`${prefix}-enterprise`);
const user = `${prefix}-user`;
const db = new PgDatabase(appConfig()), credits = new PgCreditConsumption(db), wallets = new PgBillingWalletRepository(db);
// @global-scope-fixture table:credit_wallets: only this file's exact personal/enterprise wallet owners are mutated and removed.
const policy = (enabled: boolean) => asApp(enterprise, c => c.query("UPDATE credit_consumption_settings SET credit_preflight_enabled=$1 WHERE singleton", [enabled]));
const start = (id: string, maximumTokens: number | null = 1000) => ({requestId: `${prefix}-${id}`, userId: user, runId: null,
  modelProvider: "test", modelId: "test-model", startedAt: new Date().toISOString(), executionAttemptId: null, projectId: null, maximumTokens});
const reserve = (org: OrgId, id: string, maximumTokens: number | null = 1000) => db.withTenant(org, s => credits.reserveInSession(s, org, start(id, maximumTokens)));
const usage = (id: string, tokens = 1000): TokenUsageRecord => ({eventId: `${prefix}-${id}`, userId: user, runId: null, modelProvider: "test", modelId: "test-model", tokensTotal: tokens,
  promptTokens: tokens, completionTokens: 0, totalSource: "reported", outcome: "succeeded"});
const settle = (org: OrgId, id: string, tokens = 1000) => db.withTenant(org, s => credits.settleInSession(s, org, usage(id, tokens)));
const balance = (org: OrgId) => wallets.wallet({orgId: org, ownerType: org === personal ? "user" : "team", ownerId: org === personal ? user : enterprise});
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await seedOrg({orgId: personal, kind: "personal-local", ownerUserId: user, projectId: `${personal}-project`});
  await seedOrg({orgId: enterprise, projectId: `${enterprise}-project`});
  for (const org of [personal, enterprise]) await asApp(org, c => c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING", [user, org]));
  await asApp(personal, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('user',$1),('team',$2)", [user, enterprise]));
});
beforeEach(async () => {
  await asOwner(c => c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])", [[personal, enterprise]]));
  await asApp(personal, c => c.query("UPDATE credit_wallets SET balance=0,held_hundredths=0,unbounded_requests=0 WHERE owner_id=ANY($1::text[])", [[user, enterprise]]));
  await policy(false);
});
afterAll(async () => {
  await policy(false);
  await asOwner(async c => {
    await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])", [[personal, enterprise]]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))", [[user, enterprise]]);
    await c.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])", [[user, enterprise]]);
  });
  await db.close();
});

it("admits zero personal balance, completes into debt, then blocks a new physical dispatch", async () => {
  await policy(true);
  let dispatches = 0;
  await reserve(personal, "zero"); dispatches++;
  await settle(personal, "zero"); await settle(personal, "zero");
  expect((await balance(personal)).wallet.balance).toBe(-1);
  await expect((async () => {await reserve(personal, "new-after-debt"); dispatches++;})()).rejects.toMatchObject({code: "credit_required"});
  expect(dispatches).toBe(1);
});
it("lets an admitted request cost more than the positive starting balance", async () => {
  await policy(true);
  await asApp(personal, c => c.query("UPDATE credit_wallets SET balance=0.01 WHERE owner_type='user' AND owner_id=$1", [user]));
  await reserve(personal, "small-balance"); await settle(personal, "small-balance");
  expect((await balance(personal)).wallet.balance).toBe(-0.99);
});
it("blocks negative personal balance even when the legacy global preflight flag is off", async () => {
  await asApp(personal, c => c.query("UPDATE credit_wallets SET balance=-0.01 WHERE owner_type='user' AND owner_id=$1", [user]));
  await expect(reserve(personal, "negative")).rejects.toMatchObject({code: "credit_required"});
});
it("admits enterprise debt even when the legacy preflight flag is on", async () => {
  await policy(true);
  await asApp(enterprise, c => c.query("UPDATE credit_wallets SET balance=-2 WHERE owner_type='team' AND owner_id=$1", [enterprise]));
  await reserve(enterprise, "enterprise-debt"); await settle(enterprise, "enterprise-debt");
  expect((await balance(enterprise)).wallet.balance).toBe(-3);
});
it("completes every concurrent request admitted before personal debt becomes visible", async () => {
  await policy(true);
  await Promise.all([reserve(personal, "parallel-a"), reserve(personal, "parallel-b")]);
  await Promise.all([settle(personal, "parallel-a"), settle(personal, "parallel-b")]);
  expect((await balance(personal)).wallet.balance).toBe(-2);
  await expect(reserve(personal, "parallel-new")).rejects.toMatchObject({code: "credit_required"});
});
it("uses the actual balance for availability instead of subtracting an estimated request maximum", async () => {
  await asApp(personal, c => c.query("UPDATE credit_wallets SET balance=1 WHERE owner_type='user' AND owner_id=$1", [user]));
  await reserve(personal, "estimate");
  expect((await balance(personal)).wallet).toMatchObject({balance: 1, availableBalance: 1, reservedCredits: 1});
  await settle(personal, "estimate", 0);
});
