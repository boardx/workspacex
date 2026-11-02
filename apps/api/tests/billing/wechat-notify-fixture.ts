import { createCipheriv, randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { registerBillingRawBodyParser } from "../../src/interface/middleware/billing-raw-body-parser";
import type { Request, Response } from "express";
import { orderFixture, type BillingFixtureOptions } from "./order-fixture";
import { asOwner } from "../support/db";

export interface ReceiptWorker {
  runOnce(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
export async function notifyFixture(background = false, options: BillingFixtureOptions = {}) {
  const network = { dropAck: false };
  const base = await orderFixture(app => {
    const server = app.getHttpAdapter().getInstance();
    registerBillingRawBodyParser(server);
    server.post("/billing/webhooks/wechat", (_req: Request, res: Response, next: () => void) => {
      if (network.dropAck) { network.dropAck = false; res.end = (() => { res.destroy(); return res; }) as typeof res.end; }
      next();
    });
  }, options);
  let worker: ReceiptWorker | undefined;
  try { worker = base.app.get<ReceiptWorker>("BILLING_RECEIPT_WORKER"); } catch { /* Missing feature must fail route assertions, not fixture startup. */ }
  if (!background) await worker?.onModuleDestroy();
  async function cleanup() {
    await asOwner(async c => {
      if ((await c.query("SELECT to_regclass('billing_payment_receipts') AS t")).rows[0]?.t) await c.query("DELETE FROM billing_payment_receipts WHERE provider_event_id LIKE 'f05-%'");
      await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'f05-%' OR provider_event_id LIKE 'security:wechat:%'");
      await c.query("DELETE FROM billing_payment_conflicts WHERE user_id IN ($1,$2)",["f04-order-user","f04-order-other"]);
      await c.query("DELETE FROM billing_monthly_orders WHERE user_id IN ($1,$2)",["f04-order-user","f04-order-other"]);
      await c.query("DELETE FROM billing_subscriptions WHERE user_id IN ($1,$2)",["f04-order-user","f04-order-other"]);
      await c.query("DELETE FROM credit_consumption_requests WHERE user_id LIKE 'f04-order-%'");
      await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'f04-order-%')");
      await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'f04-order-%')");
      await c.query("DELETE FROM credit_wallets WHERE owner_id LIKE 'f04-order-%'");
      await c.query("DROP TRIGGER IF EXISTS f05_ledger_fault ON credit_transactions");
      await c.query("DROP FUNCTION IF EXISTS f05_ledger_fault()");
    });
  }
  function signed(rawBody: Buffer, timestamp = Math.floor(Date.now() / 1000), signer: KeyObject = base.crypto.platformPrivateKey) {
    const nonce = randomBytes(16).toString("hex");
    return { "Wechatpay-Timestamp": String(timestamp), "Wechatpay-Nonce": nonce, "Wechatpay-Serial": "PUB_KEY_ID_f04",
      "Wechatpay-Signature": sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody, Buffer.from("\n")]), signer).toString("base64") };
  }
  function notice(orderNo: string, override: Record<string, unknown> = {}, options: { eventId?: string; key?: string } = {}) {
    const payment = { appid: "wx-f04-fixture", mchid: "1900000001", out_trade_no: orderNo, transaction_id: `wx-${orderNo}`,
      trade_state: "SUCCESS", success_time: new Date().toISOString(), amount: { total: 9900, payer_total: 9900, currency: "CNY" }, ...override };
    const nonce = randomBytes(6).toString("hex"), aad = "transaction";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(options.key ?? base.crypto.apiV3Key), Buffer.from(nonce)); cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payment)), cipher.final(), cipher.getAuthTag()]).toString("base64");
    const eventId = options.eventId ?? `f05-${randomUUID()}`;
    const body = Buffer.from(JSON.stringify({ id: eventId, create_time: new Date().toISOString(), event_type: "TRANSACTION.SUCCESS", summary: "付款通知",
      resource_type: "encrypt-resource", resource: { algorithm: "AEAD_AES_256_GCM", original_type: "transaction", nonce, associated_data: aad, ciphertext } }, null, 2));
    return { body, headers: signed(body), eventId, payment };
  }
  return { ...base, network, worker, notice, signed,
    async reset() { await cleanup(); await base.reset(); },
    post(body: Buffer, headers: Record<string, string>) { return fetch(`${base.base}/billing/webhooks/wechat`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: new Uint8Array(body) }); },
    async createOrder(extra: Record<string, unknown> = {}) {
      const response = await base.create(extra); if (response.status !== 201) throw new Error(`order fixture create failed: ${response.status}`);
      return (await response.json()).order as { orderNo: string; ownerId: string; ownerType: string };
    },
    async close(options?: { preserveData?: boolean }) {
      await worker?.onModuleDestroy();
      try { if (!options?.preserveData) await cleanup(); } finally { await base.close(options); }
    },
  };
}
