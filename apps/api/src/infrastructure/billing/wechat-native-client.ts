import type { LoggerPort } from "../../application/ports/logger.port";
import { randomBytes, sign } from "node:crypto";
import { BillingOrderError, type OrderDraft, type WechatNativePort } from "../../application/billing/billing-order-service";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { verifyWechatSignature } from "./wechat-signature";
const path = "/v3/pay/transactions/native";
async function boundedBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      size += next.value.byteLength;
      // Cancellation is best effort: the source may never settle its cancel promise.
      if (size > 65536) { abort(); throw new Error("response_too_large"); }
      chunks.push(next.value);
    }
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function qr(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try { const url = new URL(value); return url.protocol === "weixin:" && url.hostname === "wxpay" && url.pathname === "/bizpayurl" && !!url.searchParams.get("pr") && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
/** Fixed merchant endpoint; never exposes credentials or accepts a browser-selected upstream. */
export class WechatNativeClient implements WechatNativePort {
  constructor(private readonly deployment: DeploymentBillingConfig, private readonly logger: LoggerPort) {}
  async createNativeOrder(order: OrderDraft, traceId = "no-trace"): Promise<string> {
    const config = this.deployment.getWechat();
    if (!config) throw new BillingOrderError("payment_provider_not_configured");
    let stage = "request";
    let status: number | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const body = JSON.stringify({ appid: config.appId, mchid: config.mchId, description: `WorkspaceX ${order.baseCredits + order.bonusCredits} credits`, out_trade_no: order.orderNo,
        time_expire: order.expiredAt, notify_url: config.notifyUrl, amount: { total: order.amountFen, currency: order.currency } });
      const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
      const signature = sign("RSA-SHA256", Buffer.from(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`), config.privateKey).toString("base64");
      const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "zh-CN", ...(config.platformKeyId ? { "Wechatpay-Serial": config.platformKeyId } : {}), Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.mchSerialNo}",signature="${signature}"` }, body });
      status = response.status;
      stage = "body";
      const raw = await boundedBody(response, controller.signal);
      stage = "signature";
      if (config.platformKey && !verifyWechatSignature(config, name => response.headers.get(name), raw)) throw new Error("untrusted_response");
      stage = "http";
      if (!response.ok) throw new Error("upstream_http_error");
      stage = "json";
      const decoded: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
      stage = "qr";
      if (!decoded || typeof decoded !== "object" || !("code_url" in decoded) || !qr(decoded.code_url)) throw new Error("missing_native_qr");
      return decoded.code_url;
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      const reason = timeout ? "request_timeout" : ({ signature: "response_signature_invalid", http: "upstream_http_error", json: "response_json_invalid", qr: "response_qr_invalid", body: "response_body_invalid" } as Record<string, string>)[stage] ?? "request_failed";
      this.logger.error("billing_native_failed", { traceId, err: { stage, reason, status, orderNo: order.orderNo } });
      throw new BillingOrderError("wechat_upstream_failed");
    }
    finally { clearTimeout(timer); }
  }
}
