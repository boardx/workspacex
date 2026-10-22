import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {asOwner} from "../support/db";
import {orderFixture,user,other} from "./order-fixture";
let f:Awaited<ReturnType<typeof orderFixture>>;
beforeAll(async()=>{f=await orderFixture();});
beforeEach(async()=>{await f.reset();});
afterAll(async()=>{await f?.close();});
async function order(){const response=await f.create();expect(response.status).toBe(201);return (await response.json()).order;}
describe("authenticated unpaid order cancellation",()=>{
 it("closes the merchant order before persisting CLOSED and is idempotent",async()=>{
  const o=await order();const response=await f.request(`/billing/orders/${o.orderNo}/cancel`,{});
  expect(response.status).toBe(201);expect((await response.json()).order).toMatchObject({status:"CLOSED",amountFen:o.amountFen});
  expect(f.state.closeRequests).toBe(1);expect(f.state.signedRequests).toBe(2);
  expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{})).status).toBe(201);
  expect(f.state.closeRequests).toBe(1);
  expect((await asOwner(c=>c.query("SELECT status,closed_at FROM billing_orders WHERE order_no=$1",[o.orderNo]))).rows[0]).toMatchObject({status:"CLOSED",closed_at:expect.any(Date)});
  expect((await (await f.request('/billing/wallet?ownerType=user')).json()).wallet.balance).toBe(0);
 });
 it("rejects unauthenticated and foreign callers before contacting WeChat",async()=>{
  const o=await order();expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{},"")).status).toBe(401);
  expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{},"f04-other")).status).toBe(404);
  expect(f.state.closeRequests).toBe(0);expect(user).not.toBe(other);
 });
 it.each(["paid","failed"] as const)("preserves the order on merchant %s",async mode=>{
  const o=await order();f.state.closeMode=mode;
  const response=await f.request(`/billing/orders/${o.orderNo}/cancel`,{});
  expect(response.status).toBe(mode==="paid"?409:502);
  expect((await (await f.request(`/billing/orders/${o.orderNo}`)).json()).order.status).toBe("PENDING");
 });
 it("accepts an already-closed merchant response after an interrupted cancellation",async()=>{
  const o=await order();f.state.closeMode="closed";
  const response=await f.request(`/billing/orders/${o.orderNo}/cancel`,{});
  expect(response.status).toBe(201);expect((await response.json()).order.status).toBe("CLOSED");
 });
 it("does not close locally on an untrusted merchant response",async()=>{
  const o=await order();f.state.mode="bad-signature";
  expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{})).status).toBe(502);
  expect((await (await f.request(`/billing/orders/${o.orderNo}`)).json()).order.status).toBe("PENDING");
 });
 it("does not treat a manual paid recovery closure as a customer cancellation",async()=>{
  const o=await order();await asOwner(c=>c.query("UPDATE billing_orders SET status='CLOSED',closed_at=now(),last_error_code='invalid_amount' WHERE order_no=$1",[o.orderNo]));
  expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{})).status).toBe(409);
  expect(f.state.closeRequests).toBe(0);
 });
 it("does not overwrite payment processing that wins the cancellation race",async()=>{
  const o=await order();f.state.onClose=()=>asOwner(async c=>{await c.query("UPDATE billing_orders SET status='PROCESSING' WHERE order_no=$1",[o.orderNo]);});
  const response=await f.request(`/billing/orders/${o.orderNo}/cancel`,{});
  expect(response.status).toBe(201);expect((await response.json()).order.status).toBe("PROCESSING");
  expect((await f.request(`/billing/orders/${o.orderNo}/cancel`,{})).status).toBe(409);
 });
});
