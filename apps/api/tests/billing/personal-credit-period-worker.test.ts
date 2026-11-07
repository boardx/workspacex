import { afterEach, expect, it, vi } from "vitest";
import { PersonalCreditPeriodWorker } from "../../src/infrastructure/billing/personal-credit-period-worker";
import type { PersonalCreditScheduleStore, PersonalCreditSweep } from "../../src/application/billing/personal-credit-schedule.port";
const logger = () => ({ info: vi.fn(), error: vi.fn() });
afterEach(() => vi.useRealTimers());
it("does not overlap sweeps and waits for in-flight accounting before shutdown", async () => {
  let finish!: (value: { nextCursor: string | null; processed: number; failed: number }) => void;
  const store: PersonalCreditScheduleStore = { reconcileDue: vi.fn<PersonalCreditScheduleStore["reconcileDue"]>(() => new Promise<PersonalCreditSweep>(resolve => { finish = resolve; })) };
  const worker = new PersonalCreditPeriodWorker(store, logger());
  const first = worker.runOnce(); expect(worker.runOnce()).toBe(first);
  let stopped = false; const closing = worker.onModuleDestroy().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  finish({ nextCursor: null, processed: 1, failed: 0 }); await first; await closing;
  await worker.runOnce(); expect(store.reconcileDue).toHaveBeenCalledTimes(1);
});
it("advances the batch cursor, continues after account failures and wraps at the end", async () => {
  const store = { reconcileDue: vi.fn<PersonalCreditScheduleStore["reconcileDue"]>()
    .mockResolvedValueOnce({ nextCursor: "batch-last-owner", processed: 99, failed: 1 })
    .mockResolvedValueOnce({ nextCursor: null, processed: 1, failed: 0 })
    .mockResolvedValueOnce({ nextCursor: null, processed: 0, failed: 0 }) };
  const worker = new PersonalCreditPeriodWorker(store, logger());
  await worker.runOnce(); await worker.runOnce(); await worker.runOnce(); await worker.onModuleDestroy();
  expect(store.reconcileDue.mock.calls).toEqual([[null],["batch-last-owner"],[null]]);
});
it("retries a failed sweep and cancels its periodic timer on shutdown", async () => {
  vi.useFakeTimers();
  const store = { reconcileDue: vi.fn<PersonalCreditScheduleStore["reconcileDue"]>()
    .mockRejectedValueOnce(new Error("database unavailable"))
    .mockResolvedValue({ nextCursor: null, processed: 0, failed: 0 }) };
  const log = logger(), worker = new PersonalCreditPeriodWorker(store, log);
  worker.onModuleInit(); worker.onModuleInit();
  await vi.advanceTimersByTimeAsync(0); expect(store.reconcileDue).toHaveBeenCalledTimes(1); expect(log.error).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000); expect(store.reconcileDue).toHaveBeenCalledTimes(2);
  await worker.onModuleDestroy(); await vi.advanceTimersByTimeAsync(120000);
  expect(store.reconcileDue).toHaveBeenCalledTimes(2);
});
