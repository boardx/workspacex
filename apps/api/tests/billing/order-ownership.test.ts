// @global-scope-fixture table:platform_admins: f04-order-other only; order-fixture removes it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orderFixture, org, other, otherOrg, user } from "./order-fixture";
import { addCredential, asOwner } from "../support/db";
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
  it("does not turn platform authority into permission to charge an organization", async () => {
    await addCredential(other, "f04-other@example.test", "F04 platform fixture");
    await asOwner(c => c.query("INSERT INTO platform_admins(user_id,granted_by) VALUES($1,$1)", [other]));
    expect((await f.request("/billing/wallet?ownerType=team", undefined, "f04-other")).status).toBe(200);
    expect((await f.create({ ownerType: "team", ownerId: org }, "f04-other")).status).toBe(403); expect(f.state.calls).toBe(0);
  });
  it("keeps user and team orders distinct when their owner identifier is identical", async () => {
    await asOwner(async c => {
      await c.query("INSERT INTO organizations(id,name,kind) VALUES($1,'F04 collision','organization')", [user]);
      await c.query("INSERT INTO org_memberships(user_id,org_id,org_role) VALUES($1,$1,'admin')", [user]);
    });
    const personal = await f.create(), team = await f.create({ ownerType: "team", ownerId: user });
    expect(personal.status).toBe(201); expect(team.status).toBe(201);
    const a = (await personal.json()).order, b = (await team.json()).order;
    expect(a.ownerId).toBe(b.ownerId); expect(a.orderNo).not.toBe(b.orderNo);
    expect((await (await f.request(`/billing/orders/${a.orderNo}`)).json()).order.ownerType).toBe("user");
    expect((await (await f.request(`/billing/orders/${b.orderNo}`)).json()).order.ownerType).toBe("team");
  });
});
