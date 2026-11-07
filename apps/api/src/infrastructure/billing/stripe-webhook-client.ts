import { createHmac, timingSafeEqual } from "node:crypto";
import { STRIPE_INVOICE_PAGE_SIZE, type StripeEvent, type StripeSnapshotProvider, type StripeWebhookVerifier, type StripeInvoicePage } from "../../application/billing/billing-stripe-webhook-service";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { STRIPE_API_VERSION } from "./stripe-portal-client";
export class StripeWebhookClient implements StripeSnapshotProvider, StripeWebhookVerifier {
  constructor(private readonly config: DeploymentBillingConfig) {}
  verify(body: unknown, signature: unknown): StripeEvent | null {
    const config = this.config.getStripe();
    if (!config || !Buffer.isBuffer(body) || body.length > 1048576 || typeof signature !== "string" || signature.length > 4096) return null;
    const fields = signature.split(",").map(part => part.trim().split("="));
    const timestamps = fields.filter(([key]) => key === "t");
    if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0]?.[1] ?? "")) return null;
    const timestamp = Number(timestamps[0]![1]);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now()/1000-timestamp)>300) return null;
    const expected = createHmac("sha256", config.webhookSecret).update(`${timestamp}.`).update(body).digest();
    if (!fields.some(([key,value]) => key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "") && timingSafeEqual(expected, Buffer.from(value!,"hex")))) return null;
    try {
      const value = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));
      if (value.object !== "event" || typeof value.id !== "string" || !/^evt_[A-Za-z0-9_]+$/.test(value.id) || value.id.length>255 || typeof value.type !== "string" || value.type.length>255 || !value.data?.object || typeof value.data.object !== "object") return null;
      return { id: value.id, type: value.type, object: value.data.object };
    } catch { return null; }
  }
  private async retrieve(path: string, maxBytes = 65536): Promise<Record<string,unknown>> {
    const config = this.config.getStripe(); if (!config) throw Error("stripe_disabled");
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),8000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(()=>undefined); };
    controller.signal.addEventListener("abort",cancel,{once:true});
    try {
      const response = await fetch(`https://api.stripe.com/v1/${path}`,{redirect:"error",signal:controller.signal,headers:{Authorization:`Bearer ${config.secretKey}`,"Stripe-Version":STRIPE_API_VERSION}});
      if (!response.ok || !response.body) { void response.body?.cancel().catch(()=>undefined); throw Error("provider_failed"); }
      reader = response.body.getReader(); let bytes=0; const chunks: Uint8Array[]=[];
      while(true) { if(controller.signal.aborted) throw Error("deadline"); const part=await reader.read(); if(controller.signal.aborted) throw Error("deadline"); if(part.done) break; bytes+=part.value.byteLength; if(bytes>maxBytes) throw Error("response_too_large"); chunks.push(part.value); }
      const value: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
      if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("invalid_response");
      return value as Record<string,unknown>;
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort",cancel); cancel(); }
  }
  async checkout(id: string) { if(!/^cs_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_session"); const value=await this.retrieve(`checkout/sessions/${id}`); if(value.id!==id||value.object!=="checkout.session"||value.mode!=="subscription"||value.status!=="complete") throw Error("invalid_session"); return value; }
  async subscription(id: string) { if(!/^sub_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_subscription"); const value=await this.retrieve(`subscriptions/${id}`); if(value.id!==id||value.object!=="subscription") throw Error("invalid_subscription"); return value; }
  async invoice(id: string) { if(!/^in_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_invoice"); const value=await this.retrieve(`invoices/${id}`); if(value.id!==id||value.object!=="invoice") throw Error("invalid_invoice"); return value; }
  async price(id: string) { if(!/^price_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_price"); const value=await this.retrieve(`prices/${id}`); if(value.id!==id||value.object!=="price") throw Error("invalid_price"); return value; }
  async paidInvoices(subscriptionRef: string, startingAfter?: string): Promise<StripeInvoicePage> {
    if (!/^sub_[A-Za-z0-9_]{1,251}$/.test(subscriptionRef) || (startingAfter !== undefined && !/^in_[A-Za-z0-9_]{1,252}$/.test(startingAfter))) throw Error("invalid_invoice_cursor");
    const params = new URLSearchParams({ subscription: subscriptionRef, status: "paid", limit: String(STRIPE_INVOICE_PAGE_SIZE) });
    if (startingAfter !== undefined) params.set("starting_after", startingAfter);
    const page = await this.retrieve(`invoices?${params}`, 262144);
    if (page.object !== "list" || page.url !== "/v1/invoices" || typeof page.has_more !== "boolean" || !Array.isArray(page.data) ||
      page.data.length > STRIPE_INVOICE_PAGE_SIZE || page.has_more && page.data.length === 0) throw Error("invalid_invoice_page");
    const seen = new Set<string>(), data: Record<string, unknown>[] = [];
    const live = this.config.getStripe()?.secretKey.startsWith("sk_live_") === true;
    for (const value of page.data) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_invoice_page");
      const invoice = value as Record<string, unknown>, parent = invoice.parent as Record<string, unknown> | null;
      const details = parent?.subscription_details as Record<string, unknown> | null;
      if (invoice.object !== "invoice" || typeof invoice.id !== "string" || !/^in_[A-Za-z0-9_]{1,252}$/.test(invoice.id) ||
        invoice.id === startingAfter || seen.has(invoice.id) || invoice.status !== "paid" || invoice.livemode !== live ||
        parent?.type !== "subscription_details" || details?.subscription !== subscriptionRef) throw Error("invalid_invoice_page");
      seen.add(invoice.id); data.push(invoice);
    }
    return { data, hasMore: page.has_more };
  }
}
