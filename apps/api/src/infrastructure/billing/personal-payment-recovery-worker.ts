import { randomUUID } from "node:crypto";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { LoggerPort } from "../../application/ports/logger.port";
import { PERSONAL_PAYMENT_RECOVERY_INTERVAL_MS, type PersonalPaymentRecoveryStore } from "../../application/billing/personal-payment-recovery.port";

/** One admitted sweep per process; shutdown stops new work and drains the current financial operation. */
export class PersonalPaymentRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  constructor(private readonly store: PersonalPaymentRecoveryStore, private readonly logger: LoggerPort) {}
  onModuleInit(): void { if (this.started) return; this.started = true; this.schedule(0); }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().then(() => this.schedule(PERSONAL_PAYMENT_RECOVERY_INTERVAL_MS), () => this.schedule(PERSONAL_PAYMENT_RECOVERY_INTERVAL_MS));
    }, delay);
    this.timer.unref();
  }
  runOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const task = this.sweep(); this.running = task;
    const clear = () => { if (this.running === task) this.running = undefined; };
    void task.then(clear, clear); return task;
  }
  private async sweep(): Promise<void> {
    const traceId = `personal-payment-recovery:${randomUUID()}`;
    try {
      const result = await this.store.reconcileDue(() => !this.stopped);
      if (result.processed || result.failed) {
        try { this.logger.info("billing_personal_payment_recovery", { traceId, processed: result.processed, failed: result.failed }); } catch { /* diagnostics do not alter recovery */ }
      }
    } catch {
      try { this.logger.error("billing_personal_payment_recovery_failed", { traceId, err: { reason: "recovery_dependency_unavailable" } }); } catch { /* retain future retries even if diagnostics fails */ }
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; await this.running;
  }
}
