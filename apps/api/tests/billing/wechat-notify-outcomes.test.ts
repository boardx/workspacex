// @global-scope-fixture table:credit_wallets: f04-order- owners only; notifyFixture resets these wallets.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notifyFixture } from "./wechat-notify-fixture";
import { asOwner } from "../support/db";
import { user } from "./order-fixture";
import { BILLING_CREDITING_STORE, type BillingCreditingStore } from "../../src/application/billing/billing-notify-ports";
import { DeploymentWechatNoticeVerifier } from "../../src/infrastructure/billing/wechat-notice-verifier";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";

let f: Awaited<ReturnType<typeof notifyFixture>>;
beforeAll(async () => { f = await notifyFixture(); });
beforeEach(async () => { await f.reset(); });
afterAll(async () => { await f?.close(); });
async function read(orderNo: string) {
  const response = await f.request(`/billing/orders/${orderNo}`);
  expect(response.status).toBe(200);
  return (await response.json()).order;
}
async function close(orderNo: string) {
  await asOwner(c => c.query("UPDATE billing_orders SET status='CLOSED',closed_at=now() WHERE order_no=$1", [orderNo]));
  return (await read(orderNo)).closedAt;
}

describe("F05 terminal timestamps and durable paid-funds recovery", () => {
  it.each(["PENDING", "CLOSED"])("keeps acceptance timestamps null for %s until successful crediting", async initial => {
    const order = await f.createOrder();
    const closedAt = initial === "CLOSED" ? await close(order.orderNo) : null;
    const notice = f.notice(order.orderNo);
    const store = f.app.get<BillingCreditingStore>(BILLING_CREDITING_STORE);
    const verifier = new DeploymentWechatNoticeVerifier(f.app.get(DeploymentBillingConfig));
    const headers = Object.fromEntries(Object.entries(notice.headers).map(([key, value]) => [key.toLowerCase(), value]));
    expect(await store.accept(verifier.verify(notice.body, headers))).toEqual({ completed: false, manual: false });
    expect(await read(order.orderNo)).toMatchObject({ status: initial === "PENDING" ? "PROCESSING" : "CLOSED", paidAt: null, notifyAt: null, closedAt });
    expect(await store.processOne(notice.eventId)).toEqual({ completed: true, manual: false });
    const paid = await read(order.orderNo);
    expect(paid).toMatchObject({ status: "SUCCESS", paidAt: notice.payment.success_time, closedAt: null });
    expect(paid.notifyAt).not.toBeNull();
    expect((await f.post(notice.body, notice.headers)).status).toBe(200);
    expect(await read(order.orderNo)).toEqual(paid);
  });

  it.each([
    ["PENDING", "balance"], ["PENDING", "purchased"],
    ["CLOSED", "balance"], ["CLOSED", "purchased"],
  ] as const)("durably records %s paid funds exceeding %s capacity without partial credit", async (initial, limit) => {
    const balance = limit === "balance" ? 2147483640 : 0;
    const purchased = limit === "purchased" ? 2147483640 : 0;
    await asOwner(c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_purchased,total_granted) VALUES('user',$1,$2,$3,$2)", [user, balance, purchased]));
    const order = await f.createOrder();
    const closedAt = initial === "CLOSED" ? await close(order.orderNo) : null;
    const notice = f.notice(order.orderNo);
    expect((await f.post(notice.body, notice.headers)).status).toBe(200);
    const outcome = await read(order.orderNo);
    expect(outcome).toMatchObject({ status: initial === "CLOSED" ? "CLOSED" : "FAILED", closedAt, lastErrorCode: "invalid_amount", paidAt: null, notifyAt: null });
    expect(outcome).not.toHaveProperty("lastErrorMessage");
    const snapshot = () => asOwner(async c => ({
      wallet: (await c.query("SELECT balance,total_purchased,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [user])).rows,
      ledger: (await c.query("SELECT type,credits FROM credit_transactions WHERE source_id=$1", [order.orderNo])).rows,
      receipts: (await c.query("SELECT state,recovery_source_id,previous_closed_at,processed_at,attempts FROM billing_payment_receipts WHERE provider_event_id=$1", [notice.eventId])).rows,
      events: (await c.query("SELECT provider,signature_verified,result FROM billing_webhook_events WHERE provider_event_id=$1", [notice.eventId])).rows,
    }));
    const before = await snapshot();
    expect(before.wallet).toEqual([{ balance, total_purchased: purchased, total_granted: balance }]);
    expect(before.ledger).toEqual([]);
    expect(before.receipts).toHaveLength(1);
    expect(before.receipts[0]).toMatchObject({ state: "failed", recovery_source_id: `payment-recovery:${order.orderNo}`, attempts: 0 });
    expect(before.receipts[0]!.processed_at).toBeInstanceOf(Date);
    expect(before.receipts[0]!.previous_closed_at?.toISOString() ?? null).toBe(closedAt);
    expect(before.events).toEqual([{ provider: "wechat", signature_verified: true, result: "rejected" }]);
    expect((await f.post(notice.body, notice.headers)).status).toBe(200);
    await f.worker?.runOnce();
    expect(await snapshot()).toEqual(before);
    expect(await read(order.orderNo)).toEqual(outcome);
  });
});
