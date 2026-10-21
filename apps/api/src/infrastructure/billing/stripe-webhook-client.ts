import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeEvent, StripeSnapshotProvider, StripeWebhookVerifier } from "../../application/billing/billing-stripe-webhook-service";
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
  private async retrieve(path: string): Promise<Record<string,unknown>> {
    const config = this.config.getStripe(); if (!config) throw Error("stripe_disabled");
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),8000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(()=>undefined); };
    controller.signal.addEventListener("abort",cancel,{once:true});
    try {
      const response = await fetch(`https://api.stripe.com/v1/${path}`,{redirect:"error",signal:controller.signal,headers:{Authorization:`Bearer ${config.secretKey}`,"Stripe-Version":STRIPE_API_VERSION}});
      if (!response.ok || !response.body) { void response.body?.cancel().catch(()=>undefined); throw Error("provider_failed"); }
      reader = response.body.getReader(); let bytes=0; const chunks: Uint8Array[]=[];
      while(true) { if(controller.signal.aborted) throw Error("deadline"); const part=await reader.read(); if(controller.signal.aborted) throw Error("deadline"); if(part.done) break; bytes+=part.value.byteLength; if(bytes>65536) throw Error("response_too_large"); chunks.push(part.value); }
      const value: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
      if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("invalid_response");
      return value as Record<string,unknown>;
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort",cancel); cancel(); }
  }
  async checkout(id: string) { if(!/^cs_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_session"); const value=await this.retrieve(`checkout/sessions/${id}`); if(value.id!==id||value.object!=="checkout.session"||value.mode!=="subscription"||value.status!=="complete") throw Error("invalid_session"); return value; }
  async subscription(id: string) { if(!/^sub_[A-Za-z0-9_]+$/.test(id)||id.length>255) throw Error("invalid_subscription"); const value=await this.retrieve(`subscriptions/${id}`); if(value.id!==id||value.object!=="subscription") throw Error("invalid_subscription"); return value; }
}
