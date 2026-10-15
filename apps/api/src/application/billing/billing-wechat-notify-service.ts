import { randomUUID } from "node:crypto";
import type { LoggerPort } from "../ports/logger.port";
import { PaymentNoticeError, type BillingCreditingStore, type WechatNoticeVerifier, type VerifiedPaymentReceipt } from "./billing-notify-ports";
export type NotifyResponse = { status: number; body: { code: "SUCCESS" | "FAIL" } };
const success: NotifyResponse = { status: 200, body: { code: "SUCCESS" } };
const retry: NotifyResponse = { status: 503, body: { code: "FAIL" } };
export class BillingWechatNotifyService {
  private readonly tasks = new Set<Promise<NotifyResponse>>();
  constructor(private readonly verifier: WechatNoticeVerifier, private readonly store: BillingCreditingStore, private readonly logger: LoggerPort) {}
  async handle(body: unknown, headers: Readonly<Record<string, string | string[] | undefined>>, requestTraceId?: string): Promise<NotifyResponse> {
    if (!Buffer.isBuffer(body)) return { status: 400, body: { code: "FAIL" } };
    const traceId = requestTraceId && requestTraceId !== "no-trace" ? requestTraceId : randomUUID();
    const task = this.process(body, headers, traceId);
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    // A deadline is not cancellation: tracked durable work may finish after a 503;
    // the next provider delivery observes the committed receipt without crediting twice.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<NotifyResponse>(resolve => { timer = setTimeout(() => { this.logger.info("billing_callback_deadline", { traceId, stage: "http_deadline" }); resolve(retry); }, 4000); timer.unref(); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private async process(body: Buffer, headers: Readonly<Record<string, string | string[] | undefined>>, traceId: string): Promise<NotifyResponse> {
    let receipt: VerifiedPaymentReceipt | undefined;
    let stage = "verify";
    try {
      receipt = this.verifier.verify(body, headers);
      stage = "accept";
      const accepted = await this.store.accept(receipt);
      if (accepted.completed) return success;
      stage = "credit";
      const credited = await this.store.processOne(receipt.providerEventId);
      if (credited.completed) return success;
      this.logger.info("billing_callback_pending", { traceId, stage: "credit", providerEventId: receipt.providerEventId, orderNo: receipt.orderNo });
      return retry;
    } catch (error) {
      if (error instanceof PaymentNoticeError) {
        if (error.reason === "provider_unavailable") return retry;
        try { await this.store.auditRejection(error.signatureVerified, error.orderNo); } catch (auditError) { this.failure(auditError, "audit_rejection", traceId, receipt); return retry; }
        return { status: 400, body: { code: "FAIL" } };
      }
      this.failure(error, stage, traceId, receipt);
      return retry;
    }
  }
  private failure(error: unknown, stage: string, traceId: string, receipt?: VerifiedPaymentReceipt): void {
    const candidate = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const code = typeof candidate === "string" && /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate : "unknown";
    // Error messages, SQL detail, callback bodies and headers can contain secrets or
    // payer data. Keep a whitelist of operational facts instead of serializing them.
    this.logger.error("billing_callback_failed", { traceId, err: { stage, code, providerEventId: receipt?.providerEventId, orderNo: receipt?.orderNo } });
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.tasks]); }
}
