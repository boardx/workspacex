import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { BillingOrderExpiryStore } from "../../application/billing/billing-order-expiry.port";
import type { LoggerPort } from "../../application/ports/logger.port";

const diagnosticCodes = new Set(["23514", "40001", "40P01", "57014", "55P03", "53300", "57P01", "08006", "ECONNREFUSED", "ETIMEDOUT"]);
/** Database timestamps and conditional row locks, rather than timers, decide eligibility. */
export class BillingOrderExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  constructor(private readonly store: BillingOrderExpiryStore, private readonly logger: LoggerPort) {}
  onModuleInit(): void {
    if (this.started) return;
    this.started = true; this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().then(() => this.schedule(60000), () => this.schedule(60000));
    }, delay);
    this.timer.unref();
  }
  runOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const task = this.sweep(); this.running = task;
    const clear = () => { if (this.running === task) this.running = undefined; };
    void task.then(clear, clear);
    return task;
  }
  private async sweep(): Promise<void> {
    const traceId = `billing-order-expiry:${randomUUID()}`;
    try {
      const closedCount = await this.store.closeExpired();
      if (closedCount > 0) this.logger.info("billing_orders_expired", { traceId, closedCount });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && diagnosticCodes.has(error.code) ? error.code : "other";
      this.logger.error("billing_order_expiry_failed", { traceId, err: { stage: "expiry_sweep", code } });
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
