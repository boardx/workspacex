import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orderFixture, org, other, otherOrg } from "./order-fixture";
let f: Awaited<ReturnType<typeof orderFixture>>;
beforeAll(async () => { f = await orderFixture(); });
beforeEach(async () => { await f.reset(); });
afterAll(async () => { await f?.close(); });
describe("F04 HTTP order ownership with persisted memberships", () => {
  it("rejects forged personal owners before Native dispatch", async () => {
    expect((await f.create({ ownerId: other })).status).toBe(403); expect(f.state.calls).toBe(0);
  });
  it("requires explicit organization and the actual target administrator", async () => {
    expect((await f.create({ ownerType: "team" })).status).toBe(400);
    expect((await f.create({ ownerType: "team", ownerId: org }, "f04-other")).status).toBe(403);
    expect((await f.create({ ownerType: "team", ownerId: otherOrg })).status).toBe(403); expect(f.state.calls).toBe(0);
    expect((await f.create({ ownerType: "team", ownerId: org })).status).toBe(201);
  });
  it("does not disclose another person's order or whether an order exists", async () => {
    const created = await f.create(); expect(created.status).toBe(201); const { order } = await created.json();
    for (const path of [`/billing/orders/${order.orderNo}`, "/billing/orders/bg20261015000000AAAAAA"]) {
      const read = await f.request(path, undefined, "f04-other"); expect(read.status).toBe(404); expect(await read.json()).toMatchObject({ code: "order_not_found" });
    }
  });
  it("does not let an ordinary member inspect team order QR or amount", async () => {
    const created = await f.create({ ownerType: "team", ownerId: org }); expect(created.status).toBe(201); const { order } = await created.json();
    const read = await f.request(`/billing/orders/${order.orderNo}`, undefined, "f04-other"); expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ code: "order_not_found" });
    expect((await f.request(`/billing/orders/${order.orderNo}`)).status).toBe(200);
  });
});
