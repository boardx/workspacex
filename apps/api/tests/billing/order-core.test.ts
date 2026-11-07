import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { operations } from "@repo/contracts/billing-credits";
import { asOwner } from "../support/db";
import { orderFixture, org, user, type Mode } from "./order-fixture";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
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
    const expiredAt=order.expiredAt;if(expiredAt===null)throw Error("pending_order_expiry_required");
    expect(order).toMatchObject({ ownerId: user, status: "PENDING", amountFen: 9900, baseCredits: 1200, bonusCredits: 120, currency: "CNY", qrCodeUrl: "weixin://wxpay/bizpayurl?pr=f04fixture", paidAt: null });
    expect(Date.parse(expiredAt) - Date.parse(order.createdAt)).toBe(900000);
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
  it("selects the trusted platform key and a supported language on the actual merchant request", async () => {
    const response = await f.create(); expect(response.status).toBe(201);
    expect(f.state.requestHeaders).toHaveLength(1);
    expect(f.state.requestHeaders[0]).toMatchObject({ "accept-language": "zh-CN", "wechatpay-serial": "PUB_KEY_ID_f04" });
    expect(f.state.signedRequests).toBe(1);
  });
  it("rejects client money before contacting the merchant", async () => {
    expect((await f.create({ amountFen: 1, baseCredits: 999999 })).status).toBe(400); expect(f.state.calls).toBe(0);
  });
  for (const mode of ["non2xx", "bad-signature", "wrong-rsa", "tampered", "missing-signature", "missing-nonce", "missing-time", "stale", "unknown-key", "missing-qr", "bad-qr", "malformed", "redirect", "oversize", "timeout-headers", "timeout-body"] satisfies Mode[]) {
    it(`does not persist a fake order on ${mode}`, async () => {
      f.state.mode = mode; const response = await f.create(); expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: "wechat_upstream_failed" });
      const result = await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_orders WHERE created_by=$1", [user])); expect(result.rows[0]?.n).toBe(0);
    });
  }
  it("does not contact WeChat or create an order when the deployment is unconfigured", async () => {
    const config = f.app.get(DeploymentBillingConfig);
    const unavailable = vi.spyOn(config, "getPublicConfig").mockReturnValue({ enabledProviders: [] });
    try {
      const response = await f.create(); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "payment_provider_not_configured" });
      expect(f.state.calls).toBe(0);
      expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_orders WHERE created_by=$1", [user]))).rows[0]?.n).toBe(0);
    } finally { unavailable.mockRestore(); }
  });
  it("keeps the original package snapshot when the catalog changes during Native dispatch", async () => {
    f.state.onRequest = async () => { await asOwner(c => c.query("UPDATE credit_packages SET amount_fen=200,base_credits=10,bonus_credits=0,total_credits=10 WHERE package_id='f04-order-basic'")); };
    const response = await f.create(); expect(response.status).toBe(201);
    expect((await response.json()).order).toMatchObject({ amountFen: 9900, baseCredits: 1200, bonusCredits: 120 });
  });
  it("does not report success or silently create a second intent after a real INSERT failure", async () => {
    f.state.onRequest = async () => { await asOwner(c => c.query("DELETE FROM credit_packages WHERE package_id='f04-order-basic'")); };
    const response = await f.create(); expect(response.status).toBe(500); expect(f.state.calls).toBe(1);
    expect((await asOwner(c => c.query("SELECT count(*)::int AS n FROM billing_orders WHERE created_by=$1", [user]))).rows[0]?.n).toBe(0);
  });
  it("reads an expired order without closing it and preserves reads after billing is disabled", async () => {
    const now = Date.now();
    const date = new Date(now - 1200000);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(date);
    let orderNo: string;
    try { const response = await f.create({ ownerType: "team", ownerId: org }); expect(response.status).toBe(201); orderNo = (await response.json()).order.orderNo; }
    finally { vi.useRealTimers(); }
    await asOwner(c => c.query("INSERT INTO org_billing_settings(org_id,credit_enabled,updated_by) VALUES($1,false,$2)", [org, user]));
    const response = await f.request(`/billing/orders/${orderNo!}`); expect(response.status).toBe(200);
    const { order } = await response.json(); expect(Date.parse(order.expiredAt)).toBeLessThan(now); expect(order.status).toBe("PENDING"); expect(order.closedAt).toBeNull();
  });
  it("filters catalog scopes and permits members to browse without granting permission to buy", async () => {
    await asOwner(c => c.query("UPDATE credit_packages SET owner_type='team' WHERE package_id='f04-order-basic'"));
    const personal = operations.listPackages.out.parse(await (await f.request("/billing/packages?ownerType=user")).json());
    expect(personal.items.some(item => item.packageId === "f04-order-basic")).toBe(false);
    const team = await f.request("/billing/packages?ownerType=team", undefined, "f04-other"); expect(team.status).toBe(200);
    expect(operations.listPackages.out.parse(await team.json()).items[0]?.packageId).toBe("f04-order-basic");
    expect(await (await f.create()).json()).toMatchObject({ code: "package_disabled" }); expect(f.state.calls).toBe(0);
  });
  it("blocks disabled packages and organization billing before network dispatch", async () => {
    await asOwner(c => c.query("UPDATE credit_packages SET enabled=false WHERE package_id='f04-order-basic'"));
    expect(await (await f.create()).json()).toMatchObject({ code: "package_disabled" });
    await asOwner(async c => { await c.query("UPDATE credit_packages SET enabled=true WHERE package_id='f04-order-basic'"); await c.query("INSERT INTO org_billing_settings(org_id,credit_enabled,updated_by) VALUES($1,false,$2)", [org, user]); });
    expect(await (await f.create({ ownerType: "team", ownerId: org })).json()).toMatchObject({ code: "org_billing_disabled" }); expect(f.state.calls).toBe(0);
  });
});
