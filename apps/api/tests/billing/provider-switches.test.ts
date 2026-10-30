import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { StripePortalClient } from "../../src/infrastructure/billing/stripe-portal-client";
import { StripeWebhookClient } from "../../src/infrastructure/billing/stripe-webhook-client";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const credentials = {
  WECHAT_PAY_APP_ID: "wx-switch-fixture", WECHAT_PAY_MCH_ID: "1900000000",
  WECHAT_PAY_API_V3_KEY: "01234567890123456789012345678901", WECHAT_PAY_MCH_SERIAL_NO: "ABC123",
  WECHAT_PAY_PRIVATE_KEY: privateKey, WECHAT_PAY_NOTIFY_URL: "https://pay.example.test/wechat",
  STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_fixture",
};
afterEach(() => vi.unstubAllEnvs());

describe("independent payment purchase switches", () => {
  it.each([
    ["true", "true", ["wechat", "stripe"]], ["true", "false", ["wechat"]],
    ["false", "true", ["stripe"]], ["false", "false", []],
    ["1", "0", ["wechat"]], ["false", "typo", []],
  ])("wechat=%s stripe=%s advertises only enabled valid channels", (wechat, stripe, expected) => {
    const config = new DeploymentBillingConfig({ ...credentials, BILLING_WECHAT_ENABLED: wechat, BILLING_STRIPE_ENABLED: stripe });
    expect(config.getPublicConfig()).toEqual({ enabledProviders: expected });
    expect(config.getWechat()).not.toBeNull();
    expect(config.getStripe()).not.toBeNull();
  });
  it("retains compatibility for an unspecified switch without inventing missing credentials", () => {
    expect(new DeploymentBillingConfig(credentials).getPublicConfig().enabledProviders).toEqual(["wechat", "stripe"]);
    expect(new DeploymentBillingConfig({ BILLING_WECHAT_ENABLED: "true", BILLING_STRIPE_ENABLED: "true" }).getPublicConfig().enabledProviders).toEqual([]);
  });
  it("reads the switches from the actual startup environment and freezes the decision", () => {
    for (const [key, value] of Object.entries(credentials)) vi.stubEnv(key, value);
    vi.stubEnv("BILLING_STRIPE_ENABLED", "false"); vi.stubEnv("BILLING_WECHAT_ENABLED", "true");
    const config = new DeploymentBillingConfig();
    vi.stubEnv("BILLING_STRIPE_ENABLED", "true");
    expect(config.getPublicConfig().enabledProviders).toEqual(["wechat"]);
  });
  it("rejects new Stripe purchase links while continuing to verify signed renewal webhooks", () => {
    const config = new DeploymentBillingConfig({ ...credentials, BILLING_STRIPE_ENABLED: "false" });
    const portal = new StripePortalClient(config, { info() {}, error() {} });
    expect(portal.enabled()).toBe(false);
    expect(() => portal.purchaseLink("fixture-intent")).toThrow("payment_provider_not_configured");
    const body = Buffer.from(JSON.stringify({ id: "evt_switch_fixture", object: "event", type: "invoice.paid", data: { object: { id: "in_fixture" } } }));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", credentials.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest("hex");
    expect(new StripeWebhookClient(config).verify(body, `t=${timestamp},v1=${signature}`)?.id).toBe("evt_switch_fixture");
    expect(new StripeWebhookClient(config).verify(body, `t=${timestamp},v1=${"0".repeat(64)}`)).toBeNull();
  });
});
