import "reflect-metadata";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ensureDatabase, migrateOnce, seedOrg, asOwner } from "../support/db";
import { resetOrgsOwnedBy } from "../support/auth-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";

const prefix = `recovery-root-${randomUUID().slice(0, 8)}`, userId = `${prefix}-user`, org = toOrgId(prefix);
const merchantKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey, platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serial = "PUB_KEY_ID_RECOVERY_ROOT", originalFetch = globalThis.fetch;
const db = new PgDatabase(appConfig()); let app: NestExpressApplication, base: string, ref: string, merchantReads = 0;
// Fixture ownership: exact user/org/purchase are removed only after full application workers have drained.
// Epoch fixture ownership: one-worker isolated DB marker is restored to inactive afterAll; no real merchant request is made.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: userId, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
  const repository = new PgPersonalCheckoutRepository(db), principal = { userId, orgId: org }, product = PERSONAL_PRICE_CATALOG.cn[2]!;
  const purchase = await repository.reserve(principal, { sku: product.sku, provider: "wechat", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION,
    idempotencyKey: `root-${randomUUID()}` }, product); ref = purchase.purchaseRef;
  await repository.bind(principal, ref, { sessionRef: ref, url: "weixin://wxpay/bizpayurl?pr=rootfixture", expiresAt: new Date(Date.now() + 900000) });
  const payment = { appid: "wx-recovery-root", mchid: "1900000088", out_trade_no: ref, transaction_id: `tx${randomBytes(8).toString("hex")}`,
    trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: product.amountMinor, currency: "CNY" }, attach: `${purchase.generation}:${ref}` };
  const env: Record<string, string> = { NODE_ENV: "test", MAIL_OUTBOX_WORKER_ENABLED: "0", KERNEL_QUIET: "1", BILLING_DEPLOYMENT: "cn",
    BILLING_WECHAT_ENABLED: "false", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", WECHAT_PAY_APP_ID: "wx-recovery-root", WECHAT_PAY_MCH_ID: "1900000088",
    WECHAT_PAY_API_V3_KEY: "01234567890123456789012345678901", WECHAT_PAY_MCH_SERIAL_NO: "ABC123",
    WECHAT_PAY_PRIVATE_KEY: merchantKey.export({ type: "pkcs8", format: "pem" }).toString(),
    WECHAT_PAY_PLATFORM_KEY_ID: serial, WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
    WECHAT_PAY_NOTIFY_URL: "https://example.test/wechat" };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === "https://api.mch.weixin.qq.com") {
      expect(url.pathname).toBe(`/v3/pay/transactions/out-trade-no/${ref}`); merchantReads++;
      const body = JSON.stringify(payment), timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(12).toString("hex");
      return new Response(body, { headers: { "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": serial,
        "Wechatpay-Signature": sign("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), platform.privateKey).toString("base64") } });
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw Error("unexpected_external_request");
    return originalFetch(input, init);
  });
  const { createApp } = await import("../../src/main"); app = await createApp(); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
afterAll(async () => {
  await app?.close(); vi.unstubAllGlobals();
  await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref=$1", [ref]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1)", [userId]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId]);
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=$1", [userId]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close(); await resetOrgsOwnedBy([userId]); vi.unstubAllEnvs();
});
it("the full application automatically recovers a missed signed merchant payment while new sales are disabled", async () => {
  expect((await fetch(`${base}/billing/catalog`)).status).toBe(401);
  await expect.poll(async () => asOwner(async c => (await c.query("SELECT balance::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [userId])).rows[0]?.balance),
    { timeout: 15000, interval: 100 }).toBe("10000.00");
  expect(merchantReads).toBeGreaterThan(0);
  const counts = await asOwner(async c => (await c.query(`SELECT
    (SELECT count(*)::int FROM billing_personal_payment_receipts WHERE purchase_ref=$1) AS receipts,
    (SELECT count(*)::int FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$2 AND t.type='purchase') AS grants`, [ref, userId])).rows[0]);
  expect(counts).toEqual({ receipts: 1, grants: 1 });
});
