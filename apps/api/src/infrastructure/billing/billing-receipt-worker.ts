import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { BillingCreditingStore } from "../../application/billing/billing-notify-ports";
import type { BillingWechatNotifyService } from "../../application/billing/billing-wechat-notify-service";
/** The durable receipt, rather than a process-local job, owns recovery. */
export class BillingReceiptWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private running: Promise<void> | undefined;
  constructor(private readonly store: BillingCreditingStore, private readonly service: BillingWechatNotifyService) {}
  onModuleInit(): void { this.schedule(100); }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.runOnce().finally(() => this.schedule(5000)); }, delay);
    this.timer.unref();
  }
  runOnce(): Promise<void> {
    if (this.running) return this.running;
    const task = this.runBatch(); this.running = task;
    void task.finally(() => { if (this.running === task) this.running = undefined; });
    return task;
  }
  private async runBatch(): Promise<void> {
    const started = Date.now();
    try {
      for (const id of await this.store.due()) {
        if (Date.now() - started > 2000) break;
        try { await this.store.processOne(id); } catch { /* A conflicting event remains durable for operator investigation. */ }
      }
    } catch { /* Database downtime: retry on the next bounded sweep. */ }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
    await this.service.drain();
  }
}
