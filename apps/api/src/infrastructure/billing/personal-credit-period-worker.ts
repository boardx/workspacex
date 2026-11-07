import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { PersonalCreditScheduleStore } from "../../application/billing/personal-credit-schedule.port";

const SWEEP_INTERVAL_MS = 60_000;

/** Timers request a bounded sweep; persisted purchase anchors decide which months may grant. */
export class PersonalCreditPeriodWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private cursor: string | null = null;
  constructor(private readonly store: PersonalCreditScheduleStore, private readonly logger: LoggerPort) {}
  onModuleInit(): void { if(this.started) return; this.started=true; this.schedule(0); }
  private schedule(delay: number): void {
    if(this.stopped) return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.runOnce().then(()=>this.schedule(SWEEP_INTERVAL_MS),()=>this.schedule(SWEEP_INTERVAL_MS));},delay);
    this.timer.unref();
  }
  runOnce(): Promise<void> {
    if(this.stopped) return Promise.resolve();
    if(this.running) return this.running;
    const task=this.sweep(); this.running=task;
    const clear=()=>{if(this.running===task)this.running=undefined;};
    void task.then(clear,clear); return task;
  }
  private async sweep(): Promise<void> {
    const traceId=`personal-credit-sweep:${randomUUID()}`;
    try {
      const result=await this.store.reconcileDue(this.cursor);
      this.cursor=result.nextCursor;
      if(result.processed||result.failed)this.logger.info("billing_personal_credit_sweep",{traceId,processed:result.processed,failed:result.failed});
    } catch(error) { this.logger.error("billing_personal_credit_sweep_failed",{traceId,err:error}); }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped=true; if(this.timer)clearTimeout(this.timer);this.timer=undefined;await this.running;
  }
}
