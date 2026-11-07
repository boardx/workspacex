import { afterEach, expect, it, vi } from "vitest";
import { PersonalStripeCheckoutClient } from "../../src/infrastructure/billing/personal-stripe-checkout-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../src/domain/billing/personal-price-catalog";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";

const config = () => new DeploymentBillingConfig({
  BILLING_DEPLOYMENT: "us", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  STRIPE_RETURN_URL: "https://example.test/billing",
});
const purchase = (index = 0) => ({
  purchaseRef: "bm20261102010000ABC123", userId: "private-user", provider: "stripe" as const,
  generation: BILLING_ACCOUNTING_GENERATION, catalogVersion: PERSONAL_PRICE_CATALOG_VERSION,
  product: PERSONAL_PRICE_CATALOG.us[index]!, createdAt: new Date(),
});
const snapshot = (intent = purchase()) => ({
  object: "checkout.session", id: "cs_test_personal", mode: intent.product.kind === "subscription" ? "subscription" : "payment",
  status: "open", payment_status: "unpaid", livemode: false, url: "https://checkout.stripe.com/c/pay/personal",
  client_reference_id: intent.purchaseRef, amount_total: intent.product.amountMinor, currency: intent.product.currency.toLowerCase(),
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  metadata: { product: "personal_pricing_v1", purchase_ref: intent.purchaseRef, generation: intent.generation, sku: intent.product.sku },
});
afterEach(() => vi.unstubAllGlobals());

it.each([0, 1])("creates Pro recurring month/year from the trusted quote (%s)", async index => {
  const intent = purchase(index);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot(intent)))); vi.stubGlobal("fetch", fetcher);
  const client = new PersonalStripeCheckoutClient(config());
  await client.create(intent); await client.create(intent);
  const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = new URLSearchParams(init[1].body as string);
  expect(body.get("mode")).toBe("subscription");
  expect(body.get("line_items[0][price_data][recurring][interval]")).toBe(index === 0 ? "month" : "year");
  expect(body.get("line_items[0][price_data][recurring][interval_count]")).toBe("1");
  expect(body.get("line_items[0][price_data][unit_amount]")).toBe(String(intent.product.amountMinor));
  expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
  expect(body.get("adaptive_pricing[enabled]")).toBe("false");
  expect(body.get("subscription_data[metadata][purchase_ref]")).toBe(intent.purchaseRef);
  expect(body.get("subscription_data[metadata][generation]")).toBe(intent.generation);
  expect(body.toString()).not.toContain("private-user");
  expect(new Headers(init[1].headers).get("Idempotency-Key")).toBe(`personal-purchase:${intent.purchaseRef}`);
  expect((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe(init[1].body);
});
it("keeps credit packs as a single payment with no recurring item", async () => {
  const intent = purchase(2); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot(intent)))));
  await new PersonalStripeCheckoutClient(config()).create(intent);
  const init = vi.mocked(fetch).mock.calls[0]![1]!;
  const body = new URLSearchParams(init.body as string);
  expect(body.get("mode")).toBe("payment"); expect(body.toString()).not.toContain("recurring");
  expect(body.toString()).not.toContain("subscription_data");
});
it.each([
  { mode: "payment" }, { amount_total: 1 }, { currency: "cny" }, { livemode: true },
  { client_reference_id: "another-purchase" }, { metadata: {} },
  { url: "https://checkout.stripe.com.attacker.test/pay" }, { url: "https://user@checkout.stripe.com/pay" },
  { expires_at: 1 }, { id: "not-a-session" },
])("rejects an untrusted or inconsistent Checkout response %j", async patch => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...snapshot(), ...patch }))));
  await expect(new PersonalStripeCheckoutClient(config()).create(purchase())).rejects.toThrow();
});
it("retains settlement credentials when new sales are disabled", async () => {
  const disabled = new DeploymentBillingConfig({ BILLING_DEPLOYMENT: "us", BILLING_STRIPE_ENABLED: "false",
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_RETURN_URL: "https://example.test/billing" });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...snapshot(), status: "complete", url: null })));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersonalStripeCheckoutClient(disabled);
  expect(client.enabled()).toBe(false);
  await expect(client.retrieve("cs_test_personal")).resolves.toMatchObject({ id: "cs_test_personal", status: "complete" });
  expect(fetcher).toHaveBeenCalledOnce();
});
