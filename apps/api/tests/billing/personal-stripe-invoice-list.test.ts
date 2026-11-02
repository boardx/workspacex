import { afterEach, expect, it, vi } from "vitest";
import { StripeWebhookClient } from "../../src/infrastructure/billing/stripe-webhook-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
const config = () => new DeploymentBillingConfig({ BILLING_DEPLOYMENT: "us", STRIPE_SECRET_KEY: "sk_test_InvoiceListFixture",
  STRIPE_WEBHOOK_SECRET: "whsec_invoice_list_fixture", STRIPE_RETURN_URL: "https://example.test/billing" });
const invoice = (id = "in_page_one") => ({ object: "invoice", id, livemode: false, status: "paid",
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_owned" } } });
const page = () => ({ object: "list", url: "/v1/invoices", data: [invoice()], has_more: false });
afterEach(() => vi.unstubAllGlobals());
it("lists a bounded paid invoice page for the exact subscription on pinned Clover", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(page()))); vi.stubGlobal("fetch", fetcher);
  expect(await new StripeWebhookClient(config()).paidInvoices("sub_owned", "in_cursor")).toEqual({ data: [invoice()], hasMore: false });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit], target = new URL(url);
  expect(target.origin + target.pathname).toBe("https://api.stripe.com/v1/invoices");
  expect(Object.fromEntries(target.searchParams)).toEqual({ subscription: "sub_owned", status: "paid", limit: "5", starting_after: "in_cursor" });
  expect(new Headers(init.headers).get("Stripe-Version")).toBe("2025-09-30.clover");
});
it.each([["sub_wrong?customer=other", undefined], ["sub_owned", "cs_wrongcursor"]])("rejects unsafe pagination identities before a provider request", async (subscription, cursor) => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(new StripeWebhookClient(config()).paidInvoices(subscription!, cursor)).rejects.toThrow("invalid_invoice_cursor"); expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { object: "invoice" }, { has_more: true, data: [] }, { has_more: "false" },
  { data: [invoice(), invoice()] }, { data: Array.from({ length: 6 }, (_, i) => invoice(`in_${i}`)) },
  { data: [{ ...invoice(), livemode: true }] }, { data: [{ ...invoice(), status: "open" }] },
  { data: [{ ...invoice(), parent: { type: "subscription_details", subscription_details: { subscription: "sub_other" } } }] },
  { data: [invoice("in_cursor")], has_more: true },
])("rejects an invalid or non-progressing paid invoice page %j", async patch => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...page(), ...patch }))); vi.stubGlobal("fetch", fetcher);
  await expect(new StripeWebhookClient(config()).paidInvoices("sub_owned", "in_cursor")).rejects.toThrow("invalid_invoice_page");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("caps the invoice list response body independently of page size", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...page(), padding: "x".repeat(262145) }))));
  await expect(new StripeWebhookClient(config()).paidInvoices("sub_owned")).rejects.toThrow("response_too_large");
});
