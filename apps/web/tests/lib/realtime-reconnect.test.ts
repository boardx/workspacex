import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeReconnect, isRetryableTranscriptionError } from "@/lib/realtime-reconnect";

afterEach(() => vi.useRealTimers());

describe("bounded realtime reconnect", () => {
  it("backs off, exhausts the budget, and never overlaps duplicate failure signals", () => {
    vi.useFakeTimers();
    let attempts = 0;
    let exhausted = false;
    const retry = new RealtimeReconnect(() => { attempts++; }, () => { exhausted = true; });
    retry.begin();
    for (const [index, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
      retry.failed(true);
      retry.failed(true);
      vi.advanceTimersByTime(delay - 1);
      expect(attempts).toBe(index);
      const before = attempts;
      vi.advanceTimersByTime(1);
      expect(attempts).toBe(before + 1);
    }
    retry.failed(true);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(5);
    expect(exhausted).toBe(true);
  });

  it("waits offline, retries on online once, and cancels everything on stop", () => {
    vi.useFakeTimers();
    let online = false;
    let attempts = 0;
    const retry = new RealtimeReconnect(() => { attempts++; }, () => undefined, () => online);
    retry.begin();
    retry.failed(true);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(0);
    online = true;
    retry.online();
    retry.online();
    vi.advanceTimersByTime(1000);
    expect(attempts).toBe(1);
    retry.failed(true);
    retry.cancel();
    retry.online();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(1);
  });

  it("does not retry permanent errors or replenish a flapping connection", () => {
    vi.useFakeTimers();
    let attempts = 0;
    let exhausted = false;
    const retry = new RealtimeReconnect(() => { attempts++; }, () => { exhausted = true; });
    retry.begin();
    retry.failed(false);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(0);
    expect(exhausted).toBe(true);
    expect(isRetryableTranscriptionError("ASR_NOT_CONFIGURED")).toBe(false);
    expect(isRetryableTranscriptionError("QUOTA_EXCEEDED")).toBe(false);
    expect(isRetryableTranscriptionError("CONNECTION_FAILED")).toBe(true);
    expect(isRetryableTranscriptionError("ASR_PROVIDER_UNAVAILABLE")).toBe(true);
    retry.cancel();
  });

  it("only resets the retry budget after a stable connection", () => {
    vi.useFakeTimers();
    let attempts = 0;
    const retry = new RealtimeReconnect(() => { attempts++; }, () => undefined);
    retry.begin();
    retry.failed(true);
    vi.advanceTimersByTime(1000);
    retry.connected();
    vi.advanceTimersByTime(100);
    retry.failed(true);
    vi.advanceTimersByTime(1000);
    expect(attempts).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(attempts).toBe(2);
    retry.connected();
    vi.advanceTimersByTime(30_000);
    retry.failed(true);
    vi.advanceTimersByTime(1000);
    expect(attempts).toBe(3);
    retry.cancel();
  });
});
