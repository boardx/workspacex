import type { LoggerPort } from "../../application/ports/logger.port";
import { SubscriptionError, type SubscriptionProvider } from "../../application/billing/billing-subscription-service";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
/** Explicit, documented stable Stripe API version; fixtures assert the wire header. */
export const STRIPE_API_VERSION = "2025-09-30.clover";
type PortalReason = "response_too_large" | "response_invalid" | "upstream_http_error";
class PortalFailure extends Error { constructor(readonly reason: PortalReason) { super(reason); } }
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new PortalFailure("response_invalid");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw Error("deadline");
      const part = await reader.read(); if (signal.aborted) throw Error("deadline"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 65536) throw new PortalFailure("response_too_large"); chunks.push(part.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new PortalFailure("response_invalid"); }
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => undefined); }
}
export class StripePortalClient implements SubscriptionProvider {
  constructor(private readonly config: DeploymentBillingConfig, private readonly logger: LoggerPort) {}
  enabled() { return this.config.getStripe() !== null; }
  purchaseEnabled() { return this.config.getPublicConfig().enabledProviders.includes("stripe") && !!this.config.getStripe()?.paymentLink; }
  purchaseLink(intent: string): string {
    if (!this.purchaseEnabled()) throw new SubscriptionError("payment_provider_not_configured");
    const config = this.config.getStripe(); if (!config) throw new SubscriptionError("payment_provider_not_configured");
    const url = new URL(config.paymentLink);
    url.searchParams.delete("prefilled_email"); url.searchParams.delete("locked_prefilled_email");
    url.searchParams.set("client_reference_id", intent); url.searchParams.set("locale", "auto");
    return url.toString();
  }
  async portal(customerRef: string, traceId = "no-trace"): Promise<string> {
    const config = this.config.getStripe(); if (!config) throw new SubscriptionError("payment_provider_not_configured");
    const returnUrl = config.returnUrl ? new URL(config.returnUrl) : null;
    // A management return must refresh even when the stored subscription is active:
    // cancellation/resumption may still be in flight through Stripe webhooks.
    returnUrl?.searchParams.set("subscription_management_return", "1");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
    let stage = "request"; let status: number | undefined;
    try {
      const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.secretKey}`, "Stripe-Version": STRIPE_API_VERSION, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ customer: customerRef, locale: "auto", ...(returnUrl ? { return_url: returnUrl.toString() } : {}) }).toString() });
      status = response.status;
      stage = "http";
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new PortalFailure("upstream_http_error"); }
      stage = "body";
      const value = await readBody(response, controller.signal) as Record<string, unknown>;
      stage = "validate";
      if (!value || value.object !== "billing_portal.session" || value.customer !== customerRef || typeof value.url !== "string") throw new PortalFailure("response_invalid");
      const url = new URL(value.url);
      if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com" || url.port || url.username || url.password || !url.pathname.startsWith("/p/session/")) throw new PortalFailure("response_invalid");
      return url.toString();
    } catch (error) {
      const reason = controller.signal.aborted ? "deadline_exceeded" : error instanceof PortalFailure ? error.reason : "request_failed";
      try { this.logger.error("billing_stripe_portal_failed", { traceId, err: { stage, reason, ...(status === undefined ? {} : { status }) } }); } catch { /* diagnostics must not replace the original failure */ }
      throw new SubscriptionError("dependency_unavailable");
    }
    finally { clearTimeout(timer); }
  }
}
