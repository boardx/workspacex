// @global-scope-fixture table:credit_packages: f04-order- fixtures, restored by order-fixture.
// @global-scope-fixture table:billing_orders: f04-order- creators only, restored by order-fixture.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { operations } from "@repo/contracts/billing-credits";
import { asOwner } from "../support/db";
import { orderFixture, org, user, type Mode } from "./order-fixture";
let f: Awaited<ReturnType<typeof orderFixture>>;
beforeAll(async () => { f = await orderFixture(); });
beforeEach(async () => { await f.reset(); });
afterAll(async () => { await f?.close(); });
describe("F04 real Native order HTTP and PostgreSQL", () => {
  it("mounts authenticated package and order routes", async () => {
    expect((await f.request("/billing/packages?ownerType=user", undefined, "")).status).toBe(401);
    const response = await f.request("/billing/packages?ownerType=user"); expect(response.status).toBe(200);
    expect(operations.listPackages.out.parse(await response.json()).items[0]).toMatchObject({ packageId: "f04-order-basic", displayAmount: "¥99.00", totalCredits: 1320 });
  });
  it("creates a persisted PENDING order from server snapshot and a verified QR", async () => {
    const response = await f.create(); expect(response.status).toBe(201);
    const { order } = operations.createPaymentOrder.out.parse(await response.json());
    expect(order).toMatchObject({ ownerId: user, status: "PENDING", amountFen: 9900, baseCredits: 1200, bonusCredits: 120, currency: "CNY", qrCodeUrl: "weixin://wxpay/bizpayurl?pr=f04fixture", paidAt: null });
    expect(Date.parse(order.expiredAt) - Date.parse(order.createdAt)).toBe(900000);
    expect(f.state.signedRequests).toBe(1);
    expect(f.state.requests[0]).toMatchObject({ appid: "wx-f04-fixture", mchid: "1900000001", out_trade_no: order.orderNo, amount: { total: 9900, currency: "CNY" }, notify_url: "https://billing.example.test/api/billing/webhooks/wechat", time_expire: order.expiredAt });
    const row = await asOwner(c => c.query("SELECT created_by,amount_fen,qr_code_url FROM billing_orders WHERE order_no=$1", [order.orderNo]));
    expect(row.rows[0]).toMatchObject({ created_by: user, amount_fen: 9900, qr_code_url: order.qrCodeUrl });
    const before = await f.request("/billing/wallet?ownerType=user"); expect((await before.json()).wallet.balance).toBe(0);
    expect((await (await f.request("/billing/transactions?ownerType=user")).json()).items).toEqual([]);
    await asOwner(c => c.query("UPDATE credit_packages SET amount_fen=100 WHERE package_id='f04-order-basic'"));
    const read = await f.request(`/billing/orders/${order.orderNo}`); expect(read.status).toBe(200);
    expect((await read.json()).order.amountFen).toBe(9900);
    await expect(asOwner(c => c.query("UPDATE billing_orders SET amount_fen=1 WHERE order_no=$1", [order.orderNo]))).rejects.toThrow(/immutable/);
  });
  it("rejects client money before contacting the merchant", async () => {
    expect((await f.create({ amountFen: 1, baseCredits: 999999 })).status).toBe(400); expect(f.state.calls).toBe(0);
  });
  for (const mode of ["non2xx", "bad-signature", "missing-signature", "stale", "unknown-key", "missing-qr", "bad-qr", "malformed", "redirect"] satisfies Mode[]) {
    it(`does not persist a fake order on ${mode}`, async () => {
      f.state.mode = mode; const response = await f.create(); expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: "wechat_upstream_failed" });
      const result = await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_orders WHERE created_by=$1", [user])); expect(result.rows[0]?.n).toBe(0);
    });
  }
  it("blocks disabled packages and organization billing before network dispatch", async () => {
    await asOwner(c => c.query("UPDATE credit_packages SET enabled=false WHERE package_id='f04-order-basic'"));
    expect(await (await f.create()).json()).toMatchObject({ code: "package_disabled" });
    await asOwner(async c => { await c.query("UPDATE credit_packages SET enabled=true WHERE package_id='f04-order-basic'"); await c.query("INSERT INTO org_billing_settings(org_id,credit_enabled,updated_by) VALUES($1,false,$2)", [org, user]); });
    expect(await (await f.create({ ownerType: "team", ownerId: org })).json()).toMatchObject({ code: "org_billing_disabled" }); expect(f.state.calls).toBe(0);
  });
});
