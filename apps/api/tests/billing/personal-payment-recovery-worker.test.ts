import { afterEach, expect, it, vi } from "vitest";
import { PersonalPaymentRecoveryWorker } from "../../src/infrastructure/billing/personal-payment-recovery-worker";
import type { PersonalPaymentRecoveryStore, PersonalPaymentRecoveryStats } from "../../src/application/billing/personal-payment-recovery.port";
const logger = () => ({ info: vi.fn(), error: vi.fn() });
afterEach(() => vi.useRealTimers());
it("does not overlap and signals stop before draining the admitted recovery", async () => {
  let finish!: (value: PersonalPaymentRecoveryStats) => void, mayContinue!: () => boolean;
  const store: PersonalPaymentRecoveryStore = { reconcileDue: vi.fn<PersonalPaymentRecoveryStore["reconcileDue"]>(continueBatch => {
    mayContinue = continueBatch; return new Promise<PersonalPaymentRecoveryStats>(resolve => { finish = resolve; });
  }) };
  const worker = new PersonalPaymentRecoveryWorker(store, logger()), first = worker.runOnce();
  expect(worker.runOnce()).toBe(first); expect(mayContinue()).toBe(true);
  let stopped = false; const closing = worker.onModuleDestroy().then(() => { stopped = true; });
  expect(mayContinue()).toBe(false); await Promise.resolve(); expect(stopped).toBe(false);
  finish({ processed: 1, failed: 0 }); await first; await closing; await worker.runOnce();
  expect(store.reconcileDue).toHaveBeenCalledTimes(1);
});
it("starts once, retries a failed sweep and cancels its next timer on shutdown", async () => {
  vi.useFakeTimers();
  const store = { reconcileDue: vi.fn<PersonalPaymentRecoveryStore["reconcileDue"]>()
    .mockRejectedValueOnce(Error("fixture_dependency_unavailable")).mockResolvedValue({ processed: 0, failed: 0 }) };
  const log = logger(), worker = new PersonalPaymentRecoveryWorker(store, log);
  worker.onModuleInit(); worker.onModuleInit(); await vi.advanceTimersByTimeAsync(0);
  expect(store.reconcileDue).toHaveBeenCalledTimes(1); expect(log.error).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000); expect(store.reconcileDue).toHaveBeenCalledTimes(2);
  await worker.onModuleDestroy(); await vi.advanceTimersByTimeAsync(120000); expect(store.reconcileDue).toHaveBeenCalledTimes(2);
});
it("does not let diagnostics failure prevent future recovery attempts", async () => {
  const store = { reconcileDue: vi.fn<PersonalPaymentRecoveryStore["reconcileDue"]>()
    .mockRejectedValueOnce(Error("fixture_dependency_unavailable")).mockResolvedValue({ processed: 1, failed: 0 }) };
  const log = logger(); log.error.mockImplementation(() => { throw Error("fixture_log_failure"); });
  const worker = new PersonalPaymentRecoveryWorker(store, log); await worker.runOnce(); await worker.runOnce(); await worker.onModuleDestroy();
  expect(store.reconcileDue).toHaveBeenCalledTimes(2);
});
