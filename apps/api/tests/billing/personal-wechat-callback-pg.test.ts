import "reflect-metadata";
import { createCipheriv, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { ensureDatabase, migrateOnce, seedOrg, asApp, asOwner } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { PgPersonalCheckoutRepository } from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import { PgPersonalPaymentRepository } from "../../src/infrastructure/billing/pg-personal-payment-repository";
import { PersonalWechatCreditingStore } from "../../src/infrastructure/billing/personal-wechat-crediting-store";
import { PersonalWechatPaymentClient } from "../../src/infrastructure/billing/personal-wechat-payment-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { DeploymentWechatNoticeVerifier } from "../../src/infrastructure/billing/wechat-notice-verifier";
import { BillingWechatNotifyService } from "../../src/application/billing/billing-wechat-notify-service";
import { BillingWechatNotifyController } from "../../src/interface/controllers/billing-wechat-notify.controller";
import { registerBillingRawBodyParser } from "../../src/interface/middleware/billing-raw-body-parser";

const prefix = `native-${randomUUID().slice(0, 8)}`, org = toOrgId(prefix), users: string[] = [], events: string[] = [];
const db = new PgDatabase(appConfig()), checkout = new PgPersonalCheckoutRepository(db);
const merchantKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const apiV3Key = "01234567890123456789012345678901", serial = "PUB_KEY_ID_PERSONAL_NOTIFY";
const config = new DeploymentBillingConfig({ BILLING_DEPLOYMENT: "cn", WECHAT_PAY_APP_ID: "wx-personal-notify", WECHAT_PAY_MCH_ID: "1900000099",
  WECHAT_PAY_API_V3_KEY: apiV3Key, WECHAT_PAY_MCH_SERIAL_NO: "ABC123", WECHAT_PAY_PRIVATE_KEY: merchantKey.export({ type: "pkcs8", format: "pem" }).toString(),
  WECHAT_PAY_PLATFORM_KEY_ID: serial, WECHAT_PAY_PLATFORM_PUBLIC_KEY: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
  WECHAT_PAY_NOTIFY_URL: "https://example.test/wechat" });
const legacy = { accept: vi.fn(async () => ({ completed: true, manual: false })), processOne: vi.fn(async () => ({ completed: true, manual: false })),
  due: vi.fn(async () => []), auditRejection: vi.fn(async () => {}) };
const logger = { info: vi.fn(), error: vi.fn() }, originalFetch = globalThis.fetch;
let app: INestApplication, base: string, service: BillingWechatNotifyService, merchant: Record<string, unknown>, reads = 0;
afterEach(async () => { await service?.drain(); legacy.accept.mockClear(); });
// All financial fixtures belong to exact recorded users/events. No shared role or global bulk deletion.
// Epoch fixture ownership: isolated database marker is restored to inactive afterAll.
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await seedOrg({ orgId: org, kind: "personal-local", ownerUserId: `${prefix}-root`, projectId: `${prefix}-project` });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION]));
  service = new BillingWechatNotifyService(new DeploymentWechatNoticeVerifier(config),
    new PersonalWechatCreditingStore(db, new PersonalWechatPaymentClient(config, logger), new PgPersonalPaymentRepository(db), legacy), logger);
  app = await NestFactory.create({ module: class NativeNotifyFixture {}, controllers: [BillingWechatNotifyController], providers: [
    { provide: BillingWechatNotifyService, useValue: service },
  ] }, { logger: false });
  registerBillingRawBodyParser(app.getHttpAdapter().getInstance()); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://api.mch.weixin.qq.com/")) {
      reads++; const body = JSON.stringify(merchant); return new Response(body, { headers: signed(Buffer.from(body)) });
    }
    return originalFetch(input, init);
  });
});
afterAll(async () => {
  await service?.drain(); await app?.close(); vi.unstubAllGlobals();
  await asOwner(async c => {
    await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))", [users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])", [users]);
    await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id=ANY($1::text[])", [events]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  }); await db.close();
});
function signed(body: Buffer) {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(12).toString("hex");
  return { "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": serial,
    "Wechatpay-Signature": sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from("\n")]), platform.privateKey).toString("base64") };
}
function notice(payment: Record<string, unknown>) {
  const eventId = `${prefix}-${randomUUID()}`; events.push(eventId);
  const nonce = randomBytes(6).toString("hex"), aad = "transaction", cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payment)), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = Buffer.from(JSON.stringify({ id: eventId, event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource",
    resource: { algorithm: "AEAD_AES_256_GCM", original_type: "transaction", nonce, associated_data: aad, ciphertext } }));
  return { body, headers: signed(body), eventId };
}
async function fixture(label: string, index = 1) {
  const userId = `${prefix}-${label}`; users.push(userId); const product = PERSONAL_PRICE_CATALOG.cn[index]!;
  const purchase = await checkout.reserve({ userId, orgId: org }, { sku: product.sku, provider: "wechat", catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, idempotencyKey: `native-${randomUUID()}` }, product);
  const payment = { appid: "wx-personal-notify", mchid: "1900000099", out_trade_no: purchase.purchaseRef, transaction_id: `tx${randomBytes(8).toString("hex")}`,
    trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: product.amountMinor, currency: "CNY" }, attach: `${purchase.generation}:${purchase.purchaseRef}` };
  return { userId, purchase, payment };
}
async function post(item: ReturnType<typeof notice>, headers = item.headers) {
  return fetch(`${base}/billing/webhooks/wechat`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: new Uint8Array(item.body) });
}
it("verifies real RSA/AES bytes and merchant reads before one annual HTTP grant", async () => {
  const f = await fixture("annual"); merchant = f.payment; const item = notice(f.payment);
  await expect.poll(async () => (await post(item)).status, { timeout: 15000, interval: 100 }).toBe(200);
  expect((await post(item)).status).toBe(200);
  const wallet = await asApp(org, async c => (await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [f.userId])).rows[0]);
  expect(wallet).toMatchObject({ balance: "20000.00", total_granted: 20000 }); expect(legacy.accept).not.toHaveBeenCalled();
});
it("rejects a signed wrong amount and a tampered signature without minting credits", async () => {
  const f = await fixture("invalid", 2); merchant = f.payment;
  expect((await post(notice({ ...f.payment, amount: { total: 1, currency: "CNY" } }))).status).toBe(400);
  const item = notice(f.payment); expect((await post(item, { ...item.headers, "Wechatpay-Signature": "AAAA" })).status).toBe(400);
  expect(await asApp(org, async c => (await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [f.userId])).rows[0].n)).toBe(0);
});
it("acknowledges an old unknown order after cutover without invoking legacy crediting", async () => {
  const count = reads, item = notice({ appid: "wx-personal-notify", mchid: "1900000099", out_trade_no: "bm20260101000000ABC123", transaction_id: "old_payment",
    trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: 18000, currency: "CNY" } });
  expect((await post(item)).status).toBe(200); expect(reads).toBe(count); expect(legacy.accept).not.toHaveBeenCalled();
  const audit = await asApp(org, async c => (await c.query("SELECT result FROM billing_webhook_events WHERE provider_event_id=$1", [item.eventId])).rows[0]);
  expect(audit).toEqual({ result: "ignored" });
});
it("fails closed for an unknown accounting generation", async () => {
  const item = notice({ appid: "wx-personal-notify", mchid: "1900000099", out_trade_no: "bm20260101000000ABC123", transaction_id: "future_test",
    trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: 18000, currency: "CNY" } });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation='future-generation-test' WHERE singleton=true"));
  try { expect((await post(item)).status).toBe(503); expect(legacy.accept).not.toHaveBeenCalled(); }
  finally { await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION])); }
});
it("keeps the legacy notification path before activation", async () => {
  const item = notice({ appid: "wx-personal-notify", mchid: "1900000099", out_trade_no: "bm20260101000000ABC123", transaction_id: "legacy_before_activation",
    trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: 18000, currency: "CNY" } });
  await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));
  try { expect((await post(item)).status).toBe(200); expect(legacy.accept).toHaveBeenCalledOnce(); }
  finally { await asOwner(c => c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true", [BILLING_ACCOUNTING_GENERATION])); }
});
