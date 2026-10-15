import { PaymentNoticeError, type BillingCreditingStore, type WechatNoticeVerifier } from "./billing-notify-ports";
export type NotifyResponse = { status: number; body: { code: "SUCCESS" | "FAIL" } };
const success: NotifyResponse = { status: 200, body: { code: "SUCCESS" } };
const retry: NotifyResponse = { status: 503, body: { code: "FAIL" } };
export class BillingWechatNotifyService {
  private readonly tasks = new Set<Promise<NotifyResponse>>();
  constructor(private readonly verifier: WechatNoticeVerifier, private readonly store: BillingCreditingStore) {}
  async handle(body: unknown, headers: Readonly<Record<string, string | string[] | undefined>>): Promise<NotifyResponse> {
    if (!Buffer.isBuffer(body)) return { status: 400, body: { code: "FAIL" } };
    const task = this.process(body, headers);
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    // A deadline is not cancellation: tracked durable work may finish after a 503;
    // the next provider delivery observes the committed receipt without crediting twice.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<NotifyResponse>(resolve => { timer = setTimeout(() => resolve(retry), 4000); timer.unref(); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private async process(body: Buffer, headers: Readonly<Record<string, string | string[] | undefined>>): Promise<NotifyResponse> {
    try {
      const receipt = this.verifier.verify(body, headers);
      const accepted = await this.store.accept(receipt);
      if (accepted.completed) return success;
      return (await this.store.processOne(receipt.providerEventId)).completed ? success : retry;
    } catch (error) {
      if (error instanceof PaymentNoticeError) {
        if (error.reason === "provider_unavailable") return retry;
        try { await this.store.auditRejection(error.signatureVerified, error.orderNo); } catch { return retry; }
        return { status: 400, body: { code: "FAIL" } };
      }
      return retry;
    }
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.tasks]); }
}
