import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { notifyFixture } from "./wechat-notify-fixture";
import { asOwner } from "../support/db";

let f: Awaited<ReturnType<typeof notifyFixture>>;
beforeAll(async () => { f = await notifyFixture(false, { platformVerification: false }); });
beforeEach(async () => { await f.reset(); });
afterAll(async () => { await f?.close(); });
const ledgerCount = async (orderNo: string) => (await asOwner(c => c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE source_id=$1", [orderNo]))).rows[0]?.n;

describe("reference backend WeChat compatibility", () => {
  it("signs Native requests without a platform key and credits unsigned callbacks exactly once", async () => {
    f.state.mode = "missing-signature";
    const order = await f.createOrder(), notice = f.notice(order.orderNo);
    expect(f.state.signedRequests).toBe(1);
    expect(f.state.requestHeaders[0]?.["wechatpay-serial"]).toBeUndefined();
    expect((await f.post(notice.body, {})).status).toBe(200);
    expect((await f.post(notice.body, {})).status).toBe(200);
    expect(await ledgerCount(order.orderNo)).toBe(2);
    expect((await (await f.request("/billing/wallet?ownerType=user")).json()).wallet.balance).toBe(1320);
    expect((await asOwner(c => c.query("SELECT signature_verified FROM billing_payment_receipts WHERE provider_event_id=$1", [notice.eventId]))).rows[0]?.signature_verified).toBe(false);
    expect((await asOwner(c => c.query("SELECT signature_verified FROM billing_webhook_events WHERE provider_event_id=$1", [notice.eventId]))).rows[0]?.signature_verified).toBe(false);
  });
  it("still rejects failed AES-GCM authentication without crediting", async () => {
    const order = await f.createOrder(), notice = f.notice(order.orderNo, {}, { key: randomBytes(16).toString("hex") });
    expect((await f.post(notice.body, {})).status).toBe(400);
    expect(await ledgerCount(order.orderNo)).toBe(0);
  });
  it.each([{ appid: "wrong" }, { mchid: "9999999999" }, { amount: { total: 9901, currency: "CNY" } }])("rejects mismatched merchant/order facts: %j", async patch => {
    const order = await f.createOrder(), notice = f.notice(order.orderNo, patch);
    expect((await f.post(notice.body, {})).status).toBe(400);
    expect(await ledgerCount(order.orderNo)).toBe(0);
  });
});
