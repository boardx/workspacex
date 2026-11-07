import type { PersonalPurchase } from "../../application/billing/personal-checkout-ports";
import { PERSONAL_PAYMENT_PRODUCT } from "../../domain/billing/personal-payment-product";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { STRIPE_API_VERSION } from "./stripe-portal-client";

/** Recurring Pro and one-time packs share immutable server purchase identity. */
export class PersonalStripeCheckoutClient {
  constructor(private readonly config: DeploymentBillingConfig) {}
  enabled() { return this.config.getPublicConfig().enabledProviders.includes("stripe") && !!this.config.getStripe()?.returnUrl; }
  liveMode() { return this.config.getStripe()?.secretKey.startsWith("sk_live_") === true; }

  private async request(path: string, body?: URLSearchParams, key?: string): Promise<Record<string, unknown>> {
    const config = this.config.getStripe(); if (!config) throw Error("stripe_disabled");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => undefined); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.secretKey}`, "Stripe-Version": STRIPE_API_VERSION,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body ? { body: body.toString() } : {}),
      });
      if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); throw Error("stripe_checkout_unavailable"); }
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        if (controller.signal.aborted) throw Error("stripe_deadline");
        const part = await reader.read(); if (controller.signal.aborted) throw Error("stripe_deadline");
        if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 65536) throw Error("stripe_response_too_large"); chunks.push(part.value);
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("stripe_response_invalid");
      return value as Record<string, unknown>;
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", cancel); cancel(); }
  }
  private validate(value: Record<string, unknown>) {
    if (value.object !== "checkout.session" || !["subscription", "payment"].includes(String(value.mode)) ||
      value.livemode !== this.liveMode() || typeof value.id !== "string" || !/^cs_[A-Za-z0-9_]{1,252}$/.test(value.id) ||
      !["open", "complete", "expired"].includes(String(value.status))) throw Error("personal_checkout_invalid");
    if (value.url != null) {
      if (typeof value.url !== "string") throw Error("personal_checkout_url_invalid");
      const url = new URL(value.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || url.username || url.password) throw Error("personal_checkout_url_invalid");
    }
    return value;
  }
  async create(purchase: PersonalPurchase) {
    const config = this.config.getStripe(); if (!config?.returnUrl) throw Error("stripe_disabled");
    const product = purchase.product, recurring = product.kind === "subscription";
    const success = new URL(config.returnUrl), cancel = new URL(config.returnUrl);
    for (const url of [success, cancel]) url.searchParams.set("purchase_ref", purchase.purchaseRef);
    const metadata = { product: PERSONAL_PAYMENT_PRODUCT, purchase_ref: purchase.purchaseRef, generation: purchase.generation, sku: product.sku };
    const body = new URLSearchParams({ mode: recurring ? "subscription" : "payment", "adaptive_pricing[enabled]": "false",
      client_reference_id: purchase.purchaseRef, "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": product.currency.toLowerCase(), "line_items[0][price_data][unit_amount]": String(product.amountMinor),
      "line_items[0][price_data][product_data][name]": recurring ? "WorkspaceX Pro" : "WorkspaceX Credits",
      success_url: success.toString(), cancel_url: cancel.toString(), "payment_method_types[0]": "card" });
    for (const [key, value] of Object.entries(metadata)) {
      body.set(`metadata[${key}]`, value);
      if (recurring) body.set(`subscription_data[metadata][${key}]`, value);
    }
    if (recurring) {
      body.set("line_items[0][price_data][recurring][interval]", product.cycle);
      body.set("line_items[0][price_data][recurring][interval_count]", "1");
    }
    const value = this.validate(await this.request("checkout/sessions", body, `personal-purchase:${purchase.purchaseRef}`));
    const actual = value.metadata as Record<string, unknown> | null;
    if (value.mode !== (recurring ? "subscription" : "payment") || value.client_reference_id !== purchase.purchaseRef ||
      value.amount_total !== product.amountMinor || value.currency !== product.currency.toLowerCase() ||
      Object.entries(metadata).some(([key, expected]) => actual?.[key] !== expected) ||
      typeof value.expires_at !== "number" || !Number.isSafeInteger(value.expires_at) ||
      value.expires_at * 1000 <= purchase.createdAt.getTime()) throw Error("personal_checkout_snapshot_mismatch");
    return value;
  }
  async retrieve(id: string) {
    if (!/^cs_[A-Za-z0-9_]{1,252}$/.test(id)) throw Error("personal_checkout_id_invalid");
    const value = this.validate(await this.request(`checkout/sessions/${id}`));
    if (value.id !== id) throw Error("personal_checkout_id_invalid");
    return value;
  }
}
