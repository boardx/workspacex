import { afterEach, expect, it, vi } from "vitest";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
afterEach(() => vi.useRealTimers());
it("keeps a timerless execution scope alive across 180s and 600s of individually bounded calls", async () => {
  vi.useFakeTimers(); const scope = SearchBudget.perCall(90_000);
  try {
    for (let i = 0; i < 12; i++) {
      const call = scope.run(async () => { await new Promise(resolve => setTimeout(resolve, 60_000)); return i; });
      await vi.advanceTimersByTimeAsync(60_000); expect(await call).toBe(i); scope.check();
    }
    await vi.advanceTimersByTimeAsync(600_000); scope.check(); expect(scope.signal.aborted).toBe(false);
  } finally { scope.dispose(); }
});
it("bounds each hung call and isolates a late response without expiring the execution scope", async () => {
  vi.useFakeTimers(); const scope = SearchBudget.perCall(100); let release!: () => void, callSignal!: AbortSignal;
  try {
    const pending = scope.run(signal => { callSignal = signal; return new Promise<void>(resolve => { release = resolve; }); });
    const result = pending.catch(error => error); await vi.advanceTimersByTimeAsync(101);
    expect((await result).reasonCode).toBe("RESEARCH_SOURCE_MODEL_TIMEOUT"); expect(callSignal.aborted).toBe(true);
    release(); scope.check(); expect(await scope.run(async () => "next")).toBe("next");
  } finally { scope.dispose(); }
});
it("propagates parent cancellation to the active call and rejects new admission", async () => {
  const parent = new AbortController(), error = new Error("cancel"), scope = SearchBudget.perCall(90_000, undefined, parent.signal);
  let signal!: AbortSignal;
  const pending = scope.run(child => { signal = child; return new Promise<void>(() => {}); }).catch(e => e);
  await Promise.resolve(); parent.abort(error); expect(await pending).toBe(error); expect(signal.aborted).toBe(true);
  await expect(scope.run(async () => "never")).rejects.toBe(error); scope.dispose();
});

it("does not create a request timer or call a provider for an already cancelled admission", async () => {
  vi.useFakeTimers(); const parent = new AbortController(), error = new Error("cancelled"), scope = SearchBudget.perCall();
  parent.abort(error); const provider = vi.fn(async () => "never");
  await expect(scope.run(provider, undefined, undefined, parent.signal)).rejects.toBe(error);
  expect(provider).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); scope.dispose();
});
