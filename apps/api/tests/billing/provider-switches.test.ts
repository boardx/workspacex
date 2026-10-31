import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { StripePortalClient } from "../../src/infrastructure/billing/stripe-portal-client";
import { StripeWebhookClient } from "../../src/infrastructure/billing/stripe-webhook-client";
import { BillingSubscriptionService } from "../../src/application/billing/billing-subscription-service";
import { toOrgId } from "../../src/domain/org-id";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const credentials = {
  WECHAT_PAY_APP_ID: "wx-switch-fixture", WECHAT_PAY_MCH_ID: "1900000000",
  WECHAT_PAY_API_V3_KEY: "01234567890123456789012345678901", WECHAT_PAY_MCH_SERIAL_NO: "ABC123",
  WECHAT_PAY_PRIVATE_KEY: privateKey, WECHAT_PAY_NOTIFY_URL: "https://pay.example.test/wechat",
  STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_fixture",
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("independent payment purchase switches", () => {
  it.each([["cn",["wechat"]],["us",["stripe"]],["devapp",["wechat","stripe"]],["typo",[]]])("enforces deployment %s independently of credentials",(deployment,expected)=>{
    const config=new DeploymentBillingConfig({...credentials,...(deployment==="us"?{STRIPE_SECRET_KEY:"sk_live_fixture"}:{}),BILLING_DEPLOYMENT:deployment as string});
    expect(config.getPublicConfig().enabledProviders).toEqual(expected);
    expect(config.getWechat()).not.toBeNull();expect(config.getStripe()).not.toBeNull();
  });
  it("does not expose live Stripe in devapp or test Stripe in US",()=>{
    expect(new DeploymentBillingConfig({...credentials,BILLING_DEPLOYMENT:"us"}).getPublicConfig().enabledProviders).toEqual([]);
    expect(new DeploymentBillingConfig({...credentials,STRIPE_SECRET_KEY:"sk_live_fixture",BILLING_DEPLOYMENT:"devapp"}).getPublicConfig().enabledProviders).toEqual(["wechat"]);
  });
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
    expect(portal.enabled()).toBe(true); // Existing subscriptions must remain manageable.
    expect(portal.purchaseEnabled()).toBe(false);
    expect(() => portal.purchaseLink("fixture-intent")).toThrow("payment_provider_not_configured");
    const body = Buffer.from(JSON.stringify({ id: "evt_switch_fixture", object: "event", type: "invoice.paid", data: { object: { id: "in_fixture" } } }));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", credentials.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest("hex");
    expect(new StripeWebhookClient(config).verify(body, `t=${timestamp},v1=${signature}`)?.id).toBe("evt_switch_fixture");
    expect(new StripeWebhookClient(config).verify(body, `t=${timestamp},v1=${"0".repeat(64)}`)).toBeNull();
  });
  it("denies upgrades before creating an intent but permits cancellation management with purchases disabled", async () => {
    const config = new DeploymentBillingConfig({ ...credentials, BILLING_STRIPE_ENABLED: "false" });
    const portal = new StripePortalClient(config, { info() {}, error() {} });
    const createIntent = vi.fn(async () => "unused");
    const read = vi.fn(async () => ({ status: "active" as const, planRef: "price_fixture", currentPeriodEnd: null,
      cancelAtPeriodEnd: false, customerRef: "cus_fixture", subscriptionRef: "sub_fixture", generation: "fixture", synchronizationUncertain: false }));
    const service = new BillingSubscriptionService({ read, createIntent }, portal);
    const principal = { userId: "switch-fixture", orgId: toOrgId("org-switch-fixture") };
    await expect(service.upgrade(principal)).rejects.toMatchObject({ code: "payment_provider_not_configured" });
    expect(createIntent).not.toHaveBeenCalled();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ object: "billing_portal.session", customer: "cus_fixture", url: "https://billing.stripe.com/p/session/fixture" })));
    vi.stubGlobal("fetch", fetcher);
    await expect(service.management(principal)).resolves.toEqual({ url: "https://billing.stripe.com/p/session/fixture" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
