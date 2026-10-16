import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { notifyFixture } from "./wechat-notify-fixture";
import { asOwner } from "../support/db";
let f: Awaited<ReturnType<typeof notifyFixture>>;
beforeAll(async () => { f = await notifyFixture(); });
beforeEach(async () => { await f.reset(); });
afterAll(async () => { await f?.close(); });
async function noMoney(orderNo: string) {
  expect((await asOwner(c => c.query("SELECT status FROM billing_orders WHERE order_no=$1", [orderNo]))).rows[0]?.status).toBe("PENDING");
  expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE source_id=$1", [orderNo]))).rows[0]?.n).toBe(0);
}
describe("F05 raw WeChat callback cryptographic boundary", () => {
  it("accepts authentic whitespace and UTF8 bytes without requiring a user session", async () => {
    const order = await f.createOrder(), n = f.notice(order.orderNo);
    const response = await f.post(n.body, n.headers); expect(response.status).toBe(200); expect(await response.json()).toEqual({ code: "SUCCESS" });
  });
  for (const defect of ["tampered", "missing-signature", "missing-nonce", "stale", "unknown-key", "wrong-rsa"] as const) {
    it(`rejects ${defect} before crediting, without poisoning the real event id`, async () => {
      const order = await f.createOrder(), n = f.notice(order.orderNo);
      const headers: Record<string, string> = { ...n.headers }; let body = n.body;
      if (defect === "tampered") body = Buffer.concat([body, Buffer.from(" ")]);
      if (defect === "missing-signature") delete headers["Wechatpay-Signature"];
      if (defect === "missing-nonce") delete headers["Wechatpay-Nonce"];
      if (defect === "stale") Object.assign(headers, f.signed(body, Math.floor(Date.now() / 1000) - 3600));
      if (defect === "unknown-key") headers["Wechatpay-Serial"] = "PUB_KEY_ID_unknown";
      if (defect === "wrong-rsa") Object.assign(headers, f.signed(body, undefined, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey));
      const response = await f.post(body, headers); expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "FAIL" }); await noMoney(order.orderNo);
      expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_webhook_events WHERE provider_event_id=$1", [n.eventId]))).rows[0]?.n).toBe(0);
      expect((await f.post(n.body, n.headers)).status).toBe(200);
    });
  }
  it("does not trust a valid outer signature when AES-GCM authentication fails", async () => {
    const order = await f.createOrder(), n = f.notice(order.orderNo, {}, { key: randomBytes(16).toString("hex") });
    const response = await f.post(n.body, n.headers); expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "FAIL" }); await noMoney(order.orderNo);
  });
  for (const override of [{ appid: "other-app" }, { mchid: "9999999999" }, { amount: { total: 9901, currency: "CNY" } }, { amount: { total: 9900, currency: "USD" } }] as const) {
    it(`rejects a signed receipt inconsistent with merchant or order: ${JSON.stringify(override)}`, async () => {
      const order = await f.createOrder(), n = f.notice(order.orderNo, override);
      const response = await f.post(n.body, n.headers); expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "FAIL" }); await noMoney(order.orderNo);
    });
  }
  it("rejects signed malformed JSON with only the protocol failure body", async () => {
    const body = Buffer.from("{not-json"); const response = await f.post(body, f.signed(body)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "FAIL" });
  });
});
