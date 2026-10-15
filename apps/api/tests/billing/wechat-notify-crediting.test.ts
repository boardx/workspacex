// @global-scope-fixture table:billing_webhook_events: f05-poison signed-receipt event collisions only; notifyFixture cleans all f05- rows.
// @global-scope-fixture table:credit_wallets: f04-order- owners only; notify-fixture resets these rows.
// @global-scope-fixture table:credit_transactions: f05-starting-grant only; notify-fixture resets owner wallets and ledger.
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
async function wallet() { return (await (await f.request("/billing/wallet?ownerType=user")).json()).wallet as { balance: number; totalPurchased: number; totalGranted: number }; }
async function transactions(orderNo: string) { return (await asOwner(c => c.query("SELECT type,credits,balance_after FROM credit_transactions WHERE source_id=$1 ORDER BY created_at,credits DESC", [orderNo]))).rows; }
describe("F05 durable idempotent PostgreSQL crediting", () => {
  it("credits base and bonus separately using total price rather than coupon-discounted payer_total", async () => {
    const order = await f.createOrder(), n = f.notice(order.orderNo, { amount: { total: 9900, payer_total: 1000, currency: "CNY" } });
    expect((await f.post(n.body, n.headers)).status).toBe(200);
    expect(await wallet()).toMatchObject({ balance: 1320, totalPurchased: 1200, totalGranted: 0 });
    expect(await transactions(order.orderNo)).toEqual([{ type: "purchase", credits: 1200, balance_after: 1200 }, { type: "bonus", credits: 120, balance_after: 1320 }]);
    const result = await f.request(`/billing/orders/${order.orderNo}`); const { order: paid } = await result.json();
    expect(paid.status).toBe("SUCCESS"); expect(paid.paidAt).toBe(n.payment.success_time); expect(paid.notifyAt).not.toBeNull();
  });
  it("credits once under duplicate and distinct concurrent provider events for one order", async () => {
    const order = await f.createOrder(), first = f.notice(order.orderNo);
    const notices = Array.from({ length: 12 }, (_, i) => i % 2 ? first : f.notice(order.orderNo, { success_time: first.payment.success_time }));
    const results = await Promise.all(notices.map(n => f.post(n.body, n.headers))); expect(results.every(r => r.status === 200 || r.status === 503)).toBe(true);
    await f.worker?.runOnce(); expect((await f.post(first.body, first.headers)).status).toBe(200);
    expect(await wallet()).toMatchObject({ balance: 1320, totalPurchased: 1200 }); expect(await transactions(order.orderNo)).toHaveLength(2);
  });
  it("does not reuse an event id for a different receipt or order", async () => {
    const a = await f.createOrder(), b = await f.createOrder(), n = f.notice(a.orderNo);
    expect((await f.post(n.body, n.headers)).status).toBe(200);
    const conflict = f.notice(b.orderNo, {}, { eventId: n.eventId });
    expect((await f.post(conflict.body, conflict.headers)).status).toBe(400); expect(await transactions(b.orderNo)).toHaveLength(0); expect((await wallet()).balance).toBe(1320);
  });
  it("rejects a merchant transaction reused on a different order", async () => {
    const a=await f.createOrder(), b=await f.createOrder();
    const first=f.notice(a.orderNo,{transaction_id:"f05-shared-merchant-transaction"});
    expect((await f.post(first.body,first.headers)).status).toBe(200);
    const reused=f.notice(b.orderNo,{transaction_id:"f05-shared-merchant-transaction"});
    expect((await f.post(reused.body,reused.headers)).status).toBe(400);
    expect(await transactions(b.orderNo)).toHaveLength(0);
    expect((await wallet()).balance).toBe(1320);
  });
  it("credits at most one order when one merchant transaction races across orders", async () => {
    const a=await f.createOrder(), b=await f.createOrder();
    const notices=[a,b].map(o=>f.notice(o.orderNo,{transaction_id:"f05-raced-merchant-transaction"}));
    const responses=await Promise.all(notices.map(n=>f.post(n.body,n.headers)));
    expect(responses.every(r=>[200,400,503].includes(r.status))).toBe(true);
    expect(responses.filter(r=>r.status===200)).toHaveLength(1);
    for(const n of notices) await f.post(n.body,n.headers);
    await f.worker?.runOnce();
    expect((await wallet()).balance).toBe(1320);
    expect((await transactions(a.orderNo)).length+(await transactions(b.orderNo)).length).toBe(2);
  });
  it("honors genuine paid funds after local closure and retains the previous close audit", async () => {
    const order = await f.createOrder(); await asOwner(c => c.query("UPDATE billing_orders SET status='CLOSED',closed_at=now() WHERE order_no=$1", [order.orderNo]));
    const n = f.notice(order.orderNo); expect((await f.post(n.body, n.headers)).status).toBe(200);
    const { order: paid } = await (await f.request(`/billing/orders/${order.orderNo}`)).json(); expect(paid.status).toBe("SUCCESS"); expect(paid.closedAt).toBeNull();
    const receipt = await asOwner(c => c.query("SELECT previous_closed_at FROM billing_payment_receipts WHERE provider_event_id=$1", [n.eventId])); expect(receipt.rows[0]?.previous_closed_at).not.toBeNull();
    expect((await wallet()).balance).toBe(1320);
  });
  it("does not create a zero-credit bonus ledger entry", async () => {
    await asOwner(c => c.query("UPDATE credit_packages SET bonus_credits=0,total_credits=1200 WHERE package_id='f04-order-basic'"));
    const order = await f.createOrder(), n = f.notice(order.orderNo); expect((await f.post(n.body, n.headers)).status).toBe(200);
    expect(await transactions(order.orderNo)).toEqual([{ type: "purchase", credits: 1200, balance_after: 1200 }]); expect((await wallet()).balance).toBe(1200);
  });
  it("recovers a connection crash before commit from a durable receipt after a new app/pool starts", async () => {
    const order = await f.createOrder(), n = f.notice(order.orderNo);
    await asOwner(async c => {
      await c.query("CREATE FUNCTION f05_ledger_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$");
      await c.query("CREATE TRIGGER f05_ledger_fault BEFORE INSERT ON credit_transactions FOR EACH ROW EXECUTE FUNCTION f05_ledger_fault()");
    });
    expect((await f.post(n.body, n.headers)).status).toBe(503); expect((await wallet()).balance).toBe(0); expect(await transactions(order.orderNo)).toHaveLength(0);
    const pending = await asOwner(c => c.query("SELECT state FROM billing_payment_receipts WHERE provider_event_id=$1", [n.eventId])); expect(pending.rows[0]?.state).toBe("pending");
    await asOwner(async c => { await c.query("DROP TRIGGER f05_ledger_fault ON credit_transactions"); await c.query("DROP FUNCTION f05_ledger_fault()"); });
    await f.close({ preserveData: true }); f = await notifyFixture(true);
    await expect.poll(async () => (await wallet()).balance, { timeout: 10000, interval: 100 }).toBe(1320);
    expect(await transactions(order.orderNo)).toHaveLength(2);
    const retry = f.notice(order.orderNo, n.payment, { eventId: n.eventId }); expect((await f.post(retry.body, retry.headers)).status).toBe(200); expect((await wallet()).balance).toBe(1320);
  });
  it("does not double credit when the committed success ACK is lost on the network", async () => {
    const order = await f.createOrder(), n = f.notice(order.orderNo); f.network.dropAck = true;
    await expect(f.post(n.body, n.headers)).rejects.toThrow(); expect((await wallet()).balance).toBe(1320);
    expect((await f.post(n.body, n.headers)).status).toBe(200); expect(await transactions(order.orderNo)).toHaveLength(2);
  });
  it("does not let ten conflicting receipts starve a later valid crash-recovery receipt", async () => {
    const store = f.app.get<BillingCreditingStore>(BILLING_CREDITING_STORE);
    const verifier = new DeploymentWechatNoticeVerifier(f.app.get(DeploymentBillingConfig));
    for (let i=0; i<10; i++) {
      const order = await f.createOrder(), n = f.notice(order.orderNo);
      await asOwner(c => c.query("INSERT INTO billing_webhook_events(provider,provider_event_id,signature_verified,result) VALUES('stripe',$1,true,'ok')", [n.eventId]));
      expect((await f.post(n.body,n.headers)).status).toBe(400);
    }
    await asOwner(c => c.query("UPDATE billing_payment_receipts SET retry_at=now()-interval '1 minute' WHERE provider_event_id LIKE 'f05-%'"));
    const order = await f.createOrder(), n = f.notice(order.orderNo);
    const headers = Object.fromEntries(Object.entries(n.headers).map(([k,v]) => [k.toLowerCase(),v]));
    await store.accept(verifier.verify(n.body,headers));
    await f.worker?.runOnce(); await f.worker?.runOnce();
    expect(await transactions(order.orderNo)).toHaveLength(2);
    expect((await wallet()).balance).toBe(1320);
    const deferred = await asOwner(c => c.query("SELECT count(*)::int AS count FROM billing_payment_receipts WHERE state='pending' AND retry_at>now() AND last_error='event_conflict'"));
    expect(deferred.rows[0]?.count).toBe(10);
  });
  it("records an explicit permanent wallet limit for manual recovery without partial credit", async () => {
    await asOwner(async c => {
      const result = await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_granted) VALUES('user',$1,2147483640,2147483640) RETURNING wallet_id", [user]);
      await c.query("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason) VALUES($1,'grant',1,2147483640,2147483640,'admin_grant','f05-starting-grant',$2,'existing balance fixture')", [result.rows[0]?.wallet_id,user]);
    });
    const order = await f.createOrder(), n = f.notice(order.orderNo); expect((await f.post(n.body, n.headers)).status).toBe(200);
    expect((await wallet()).balance).toBe(2147483640); expect(await transactions(order.orderNo)).toHaveLength(0);
    const record = await asOwner(c => c.query("SELECT state,recovery_source_id FROM billing_payment_receipts WHERE provider_event_id=$1", [n.eventId])); expect(record.rows[0]).toMatchObject({ state: "failed", recovery_source_id: `payment-recovery:${order.orderNo}` });
    expect((await (await f.request(`/billing/orders/${order.orderNo}`)).json()).order.status).toBe("FAILED");
  });
});
