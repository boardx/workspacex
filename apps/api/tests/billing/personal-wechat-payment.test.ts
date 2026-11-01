import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalWechatPaymentClient } from "../../src/infrastructure/billing/personal-wechat-payment-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const environment = { BILLING_DEPLOYMENT: "cn", WECHAT_PAY_APP_ID: "wx-personal-fixture", WECHAT_PAY_MCH_ID: "1900000000",
  WECHAT_PAY_API_V3_KEY: "01234567890123456789012345678901", WECHAT_PAY_MCH_SERIAL_NO: "ABC123", WECHAT_PAY_PRIVATE_KEY: privateKey,
  WECHAT_PAY_NOTIFY_URL: "https://example.test/wechat" };
const config = new DeploymentBillingConfig(environment);
function purchase(index = 0) { return { purchaseRef: "bm20261102010000ABC123", userId: "wechat-buyer", provider: "wechat" as const,
  generation: BILLING_ACCOUNTING_GENERATION, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION, product: PERSONAL_PRICE_CATALOG.cn[index]!, createdAt: new Date() }; }
const client = () => new PersonalWechatPaymentClient(config, { info() {}, error() {} });
function upstream(intent = purchase(), patch: Record<string, unknown> = {}) {
  return { appid: "wx-personal-fixture", mchid: "1900000000", out_trade_no: intent.purchaseRef, trade_state: "SUCCESS",
    transaction_id: "420000123456", success_time: new Date(intent.createdAt.getTime() + 1000).toISOString(), amount: { total: intent.product.amountMinor, currency: "CNY" }, ...patch };
}
afterEach(() => vi.unstubAllGlobals());
it.each([0, 1, 2])("creates a one-time Native purchase using the persisted CNY quote (%s)", async index => {
  const intent = purchase(index), fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=personal" })));
  vi.stubGlobal("fetch", fetcher); const result = await client().create(intent);
  expect(result).toMatchObject({ sessionRef: intent.purchaseRef, url: "weixin://wxpay/bizpayurl?pr=personal" });
  expect(result.expiresAt).toEqual(new Date(intent.createdAt.getTime() + 900000));
  const [url, options] = fetcher.mock.calls[0]!; expect(url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native");
  const body = JSON.parse(String(options?.body));
  expect(body).toMatchObject({ out_trade_no: intent.purchaseRef, amount: { total: intent.product.amountMinor, currency: "CNY" } });
  expect(body).not.toHaveProperty("contract_id");
  if (index < 2) expect(body.description).toContain(index === 0 ? "Pro 月付" : "Pro 年付");
});
it("uses authoritative merchant reads to retain actual payment time and transaction identity", async () => {
  const intent = purchase(1); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstream(intent)))));
  expect(await client().read(intent)).toEqual({ state: "paid", paymentRef: "wx_420000123456", paidAt: new Date(intent.createdAt.getTime() + 1000) });
});
it.each([
  { amount: { total: 1, currency: "CNY" } }, { amount: { total: 19900, currency: "USD" } },
  { appid: "other-app" }, { mchid: "other-merchant" }, { out_trade_no: "another-purchase" },
  { success_time: "not-a-date" }, { transaction_id: "../not-a-transaction" }, { trade_state: "REFUND" },
])("rejects mismatched or unsupported merchant facts %j", async patch => {
  const intent = purchase(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstream(intent, patch)))));
  await expect(client().read(intent)).rejects.toThrow();
});
it("rechecks a payment racing closure instead of expiring it from a local timer", async () => {
  const intent = { ...purchase(), createdAt: new Date(Date.now() - 1000000) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(upstream(intent, { trade_state: "NOTPAY" }))))
    .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(JSON.stringify(upstream(intent)))));
  expect(await client().reconcile(intent)).toMatchObject({ state: "paid", paymentRef: "wx_420000123456" });
});
it("never treats a failed close or local expiration alone as confirmed closure", async () => {
  const intent = { ...purchase(), createdAt: new Date(Date.now() - 1000000) };
  const pending = () => new Response(JSON.stringify(upstream(intent, { trade_state: "NOTPAY" })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(pending()).mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(pending()));
  expect(await client().reconcile(intent)).toEqual({ state: "pending" });
});
it("rejects USD and stale Native creation before sending a new payable request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(client().create({ ...purchase(), product: PERSONAL_PRICE_CATALOG.us[0] })).rejects.toThrow();
  await expect(client().create({ ...purchase(), createdAt: new Date(Date.now() - 900000) })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires the configured platform signature before accepting a merchant read", async () => {
  const verifiedConfig = new DeploymentBillingConfig({ ...environment, WECHAT_PAY_PLATFORM_KEY_ID: "PUB_KEY_ID_PERSONAL",
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString() });
  const intent = purchase(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstream(intent)))));
  await expect(new PersonalWechatPaymentClient(verifiedConfig, { info() {}, error() {} }).read(intent)).rejects.toThrow("signature_invalid");
});
