import {afterAll, beforeAll, expect, it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase, migrateOnce, seedOrg, asApp, asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgBillingWalletRepository} from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import {toOrgId} from "../../src/domain/org-id";

const prefix = `credit-periods-${randomUUID()}`;
const org = toOrgId(prefix);
const user = `${prefix}-user`;
const db = new PgDatabase(appConfig());
const repository = new PgBillingWalletRepository(db);
// @global-scope-fixture table:credit_wallets: personal wallets are user-global; this file deletes its exact owner.
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({orgId: org, kind: "personal-local", ownerUserId: user, projectId: `${prefix}-project`});
  await asApp(org, c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,-1.25)", [user]));
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)", [user]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [user]);
  });
  await db.close();
});

it("exposes existing negative balance as permanent debt with no subscription credits", async () => {
  const {wallet} = await repository.wallet({orgId: org, ownerType: "user", ownerId: user});
  expect(wallet).toMatchObject({balance: -1.25, permanentBalance: -1.25, subscriptionCredits: 0, subscriptionExpiresAt: null});
});
