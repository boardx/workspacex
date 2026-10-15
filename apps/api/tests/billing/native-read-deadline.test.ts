import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { WechatNativeClient } from "../../src/infrastructure/billing/wechat-native-client";
import type { DeploymentBillingConfig, WechatDeployment } from "../../src/infrastructure/billing/deployment-billing-config";
import type { OrderDraft } from "../../src/application/billing/billing-order-service";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: WechatDeployment = { appId: "test", mchId: "123", apiV3Key: "test", mchSerialNo: "AB", privateKey: keys.privateKey,
  platformKey: keys.publicKey, platformKeyId: "PUB_KEY_ID_test", notifyUrl: "https://test.invalid/notify" };
const deployment = { getWechat: () => config } as DeploymentBillingConfig;
const order = { baseCredits: 1, bonusCredits: 0, orderNo: "cancel-boundary", expiredAt: "2030-01-01T00:00:00Z", amountFen: 1, currency: "CNY" } as OrderDraft;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["pending", "rejected"])("rejects oversized body promptly when cancellation is %s", async mode => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => mode === "pending" ? new Promise<void>(() => undefined) : Promise.reject(new Error("sensitive upstream cancellation")));
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel,
  }));
  const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
  const logger = { info: vi.fn(), error: vi.fn() };
  vi.stubGlobal("fetch", vi.fn(async () => response));
  try {
    await expect(new WechatNativeClient(deployment, logger).createNativeOrder(order, "cancel-boundary-trace"))
      .rejects.toMatchObject({ code: "wechat_upstream_failed" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(logger.error).toHaveBeenCalledWith("billing_native_failed", expect.objectContaining({ traceId: "cancel-boundary-trace",
      err: expect.objectContaining({ reason: "response_body_invalid" }) }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sensitive");
  } finally { remove.mockRestore(); }
});
