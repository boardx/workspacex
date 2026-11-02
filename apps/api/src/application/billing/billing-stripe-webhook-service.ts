import type { LoggerPort } from "../ports/logger.port";
export interface StripeEvent { id: string; type: string; object: Record<string, unknown> }
export interface StripeWebhookVerifier { verify(body: unknown, signature: unknown): StripeEvent | null }
export type StripeInvoicePage = { data: Record<string, unknown>[]; hasMore: boolean };
export const STRIPE_INVOICE_PAGE_SIZE = 5;
export interface StripeSnapshotProvider {
  checkout(id: string): Promise<Record<string, unknown>>;
  subscription(id: string): Promise<Record<string, unknown>>;
  /** Required for paid-credit grant handling; older snapshot-only adapters fail closed for paid events. */
  invoice?(id: string): Promise<Record<string, unknown>>;
  price?(id: string): Promise<Record<string, unknown>>;
  /** Bounded reconciliation; a page is not itself proof of a paid entitlement. */
  paidInvoices?(subscriptionRef: string, startingAfter?: string): Promise<StripeInvoicePage>;
}
export interface StripeWebhookStore { apply(event: StripeEvent, provider: StripeSnapshotProvider): Promise<boolean> }
export class BillingStripeWebhookService {
  constructor(private readonly verifier: StripeWebhookVerifier, private readonly provider: StripeSnapshotProvider, private readonly store: StripeWebhookStore, private readonly logger: LoggerPort) {}
  async handle(body: unknown, signature: unknown, traceId: string) {
    const event = this.verifier.verify(body, signature);
    if (!event) return { status: 400, body: { code: "signature_invalid" } };
    try {
      if (!await this.store.apply(event,this.provider)) throw Error("retry_required");
      return { status: 200, body: { received: true } };
    } catch {
      try { this.logger.error("billing_stripe_webhook_failed", { traceId, err: { reason: "synchronization_failed" } }); } catch { /* diagnostics cannot acknowledge an unprocessed event */ }
      return { status: 500, body: { error: "dependency_unavailable" } };
    }
  }
}
