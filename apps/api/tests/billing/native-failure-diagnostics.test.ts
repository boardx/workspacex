import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { operations } from "@repo/contracts/billing-credits";
import { orderFixture, user, type Mode } from "./order-fixture";
import { WechatNativeClient } from "../../src/infrastructure/billing/wechat-native-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
let f: Awaited<ReturnType<typeof orderFixture>>;
beforeAll(async()=>{ f=await orderFixture(); });
beforeEach(async()=>{ await f.reset(); });
afterAll(async()=>{ await f?.close(); });
describe("Native merchant failure diagnostics",()=>{
  it.each([
    ["non2xx","upstream_http_error"],
    ["bad-signature","response_signature_invalid"],
    ["malformed","response_json_invalid"],
    ["timeout-headers","request_timeout"],
  ] satisfies [Mode,string][])("retains safe %s cause and trace without signed bodies or credentials",async(mode,reason)=>{
    const response=await f.create(); const {order}=operations.createPaymentOrder.out.parse(await response.json());
    f.state.mode=mode;
    const client=new WechatNativeClient(f.app.get(DeploymentBillingConfig),f.requestLogger);
    await expect(client.createNativeOrder({...order,createdBy:user},"native-safe-trace")).rejects.toMatchObject({code:"wechat_upstream_failed"});
    const entries=f.requestLogger.drain();
    expect(entries).toContainEqual(expect.objectContaining({msg:"billing_native_failed",fields:expect.objectContaining({traceId:"native-safe-trace",err:expect.objectContaining({reason})})}));
    const log=JSON.stringify(entries);
    expect(log).not.toContain("WECHATPAY2-SHA256-RSA2048");
    expect(log).not.toContain("PRIVATE KEY");
    expect(log).not.toContain("code_url");
  });
});
