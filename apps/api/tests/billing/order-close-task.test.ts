// @global-scope-fixture table:billing_orders: cloned f04-order- owner snapshots only; notifyFixture removes these orders.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { notifyFixture } from "./wechat-notify-fixture";
import { asOwner } from "../support/db";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { ConsoleLogger } from "../../src/infrastructure/logging/console-logger";
import { BILLING_ORDER_EXPIRY_WORKER } from "../../src/application/billing/billing-order-expiry.port";
import { BillingOrderExpiryWorker } from "../../src/infrastructure/billing/billing-order-expiry-worker";
import { PgBillingOrderExpiryStore } from "../../src/infrastructure/billing/pg-billing-order-expiry-store";
import { BILLING_CREDITING_STORE, type BillingCreditingStore } from "../../src/application/billing/billing-notify-ports";
import { DeploymentWechatNoticeVerifier } from "../../src/infrastructure/billing/wechat-notice-verifier";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";

describe("F07 restart-safe bounded expiry lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  it("sweeps on startup and every minute, then stops scheduling after destruction", async () => {
    vi.useFakeTimers();
    const closeExpired = vi.fn().mockResolvedValue(0);
    const worker = new BillingOrderExpiryWorker({ closeExpired }, new ConsoleLogger(true));
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(0); expect(closeExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000); expect(closeExpired).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy(); await vi.advanceTimersByTimeAsync(120000);
    expect(closeExpired).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("shares the in-flight run and joins it on shutdown without another batch", async () => {
    vi.useFakeTimers(); let release!: (count: number) => void;
    const closeExpired = vi.fn(() => new Promise<number>(resolve => { release = resolve; }));
    const worker = new BillingOrderExpiryWorker({ closeExpired }, new ConsoleLogger(true));
    worker.onModuleInit(); await vi.advanceTimersByTimeAsync(0);
    const first = worker.runOnce(); const second = worker.runOnce(); expect(first).toBe(second);
    await vi.advanceTimersByTimeAsync(180000); expect(closeExpired).toHaveBeenCalledTimes(1);
    let stopped = false; const stop = worker.onModuleDestroy().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(1); await stop; expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(120000); expect(closeExpired).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed sweep observable without raw database details and retries next tick", async () => {
    vi.useFakeTimers(); const logger = new ConsoleLogger(true);
    const closeExpired = vi.fn().mockRejectedValueOnce(new Error("private database detail")).mockResolvedValue(2);
    const worker = new BillingOrderExpiryWorker({ closeExpired }, logger);
    worker.onModuleInit(); await vi.advanceTimersByTimeAsync(0);
    const entries = logger.drain(); expect(entries.some(entry => entry.msg === "billing_order_expiry_failed")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("private database detail");
    await vi.advanceTimersByTimeAsync(60000); expect(closeExpired).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });
});

describe("F07 actual PostgreSQL expiry and payment races", () => {
  let f: Awaited<ReturnType<typeof notifyFixture>>;
  let store: PgBillingOrderExpiryStore;
  beforeAll(async () => {
    f = await notifyFixture();
    await f.app.get<BillingOrderExpiryWorker>(BILLING_ORDER_EXPIRY_WORKER).onModuleDestroy();
    store = new PgBillingOrderExpiryStore(f.app.get<DatabasePort>(DATABASE_PORT));
  });
  beforeEach(async () => { await f.reset(); });
  afterAll(async () => { await f?.close(); });
  // Timestamp snapshots are immutable: insert a separate expired fixture instead
  // of disabling the trigger or modifying an already-created order's timestamps.
  async function seed(ageSeconds = 901, expiredSeconds = 1, status = "PENDING") {
    const source = await f.createOrder(); const orderNo = `bg20261016000000${randomBytes(3).toString("hex")}`;
    await asOwner(c => c.query(`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,created_at,expired_at,closed_at)
      SELECT $2,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,$5,qr_code_url,
      now()-$3*interval '1 second',now()-$4*interval '1 second',CASE WHEN $5='CLOSED' THEN now()-interval '2 seconds' ELSE NULL END
      FROM billing_orders WHERE order_no=$1`, [source.orderNo,orderNo,ageSeconds,expiredSeconds,status]));
    return orderNo;
  }
  async function read(orderNo: string) {
    return (await asOwner(c => c.query("SELECT status,closed_at FROM billing_orders WHERE order_no=$1", [orderNo]))).rows[0]!;
  }
  it("closes only expired PENDING snapshots, stamps closure once and exposes CLOSED through the real API", async () => {
    const overdue = await seed(), boundary = await seed(900,0), fresh = await seed(840,-60);
    const earlyExpiry = await seed(600,1), futureExpiry = await seed(1200,-60);
    const untouched = await Promise.all(["PROCESSING","SUCCESS","FAILED","CLOSED"].map(status => seed(1200,300,status)));
    const before = await Promise.all(untouched.map(read));
    expect(await store.closeExpired()).toBe(2);
    const closed = await read(overdue); expect(closed.status).toBe("CLOSED"); expect(closed.closed_at).toBeInstanceOf(Date);
    expect((await read(boundary)).status).toBe("CLOSED");
    for (const id of [fresh,earlyExpiry,futureExpiry]) expect(await read(id)).toEqual({ status: "PENDING", closed_at: null });
    expect(await Promise.all(untouched.map(read))).toEqual(before);
    expect(await store.closeExpired()).toBe(0); expect(await read(overdue)).toEqual(closed);
    const response = await f.request(`/billing/orders/${overdue}`); expect(response.status).toBe(200);
    expect((await response.json()).order).toMatchObject({ status: "CLOSED", closedAt: closed.closed_at.toISOString() });
    expect((await (await f.request("/billing/wallet?ownerType=user")).json()).wallet.balance).toBe(0);
  });
  it("does not wait on a callback's locked order and closes it on a later sweep", async () => {
    const locked = await seed(), free = await seed();
    await asOwner(async c => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT order_no FROM billing_orders WHERE order_no=$1 FOR UPDATE", [locked]);
        expect(await store.closeExpired()).toBe(1);
        expect((await read(free)).status).toBe("CLOSED"); expect((await read(locked)).status).toBe("PENDING");
      } finally { await c.query("ROLLBACK"); }
    });
    expect(await store.closeExpired()).toBe(1);
  });
  it("cooperating sweep instances close each order once", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => seed()));
    const counts = await Promise.all(Array.from({ length: 4 }, () => store.closeExpired()));
    expect(counts.reduce((sum,count) => sum+count,0)).toBe(ids.length);
    for (const id of ids) expect((await read(id)).status).toBe("CLOSED");
  });
  it("bounds each sweep to 100 orders and catches remaining work on a subsequent sweep", async () => {
    const source = await f.createOrder();
    await asOwner(c => c.query(`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,created_at,expired_at)
      SELECT 'bg20261016000000'||lpad(series::text,6,'0'),o.owner_type,o.owner_id,o.created_by,o.package_id,o.amount_fen,o.base_credits,o.bonus_credits,o.currency,o.provider,'PENDING',o.qr_code_url,now()-interval '16 minutes',now()-interval '1 minute'
      FROM billing_orders o CROSS JOIN generate_series(1,101) series WHERE o.order_no=$1`, [source.orderNo]));
    expect(await store.closeExpired()).toBe(100); expect(await store.closeExpired()).toBe(1); expect(await store.closeExpired()).toBe(0);
  });
  it("honors a genuine payment after closure and does not double credit it", async () => {
    const id = await seed(); expect(await store.closeExpired()).toBe(1);
    const closedAt = (await read(id)).closed_at; const notice = f.notice(id);
    expect((await f.post(notice.body,notice.headers)).status).toBe(200);
    expect(await read(id)).toEqual({ status: "SUCCESS", closed_at: null });
    expect(await store.closeExpired()).toBe(0);
    expect((await f.post(notice.body,notice.headers)).status).toBe(200);
    const receipt = await asOwner(c => c.query("SELECT previous_closed_at FROM billing_payment_receipts WHERE provider_event_id=$1", [notice.eventId]));
    expect(receipt.rows[0]!.previous_closed_at).toEqual(closedAt);
    expect((await (await f.request("/billing/wallet?ownerType=user")).json()).wallet.balance).toBe(1320);
    expect((await (await f.request("/billing/transactions?ownerType=user")).json()).items).toHaveLength(2);
  });
  it("never closes an order already claimed by a verified payment receipt", async () => {
    const id = await seed(), notice = f.notice(id);
    const verifier = new DeploymentWechatNoticeVerifier(f.app.get(DeploymentBillingConfig));
    await f.app.get<BillingCreditingStore>(BILLING_CREDITING_STORE).accept(await verifier.verify(Buffer.from(notice.body),notice.headers));
    expect((await read(id)).status).toBe("PROCESSING"); expect(await store.closeExpired()).toBe(0);
    expect((await f.post(notice.body,notice.headers)).status).toBe(200);
    expect(await read(id)).toEqual({ status: "SUCCESS", closed_at: null });
  });
  it("finishes one payment when callback and expiry race in either ordering", async () => {
    const id = await seed(), notice = f.notice(id);
    const responses = await Promise.all([f.post(notice.body,notice.headers), store.closeExpired()]);
    expect(responses[0].status).toBe(200); expect([0,1]).toContain(responses[1]);
    expect(await read(id)).toEqual({ status: "SUCCESS", closed_at: null });
    expect((await (await f.request("/billing/wallet?ownerType=user")).json()).wallet.balance).toBe(1320);
  });
});
