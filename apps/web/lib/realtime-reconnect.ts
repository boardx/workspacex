/** Explicit allow-list: permission, ownership, quota and configuration need user action. */
export function isRetryableTranscriptionError(reason: string): boolean {
  return ["CONNECTION_FAILED", "ASR_PROVIDER_UNAVAILABLE", "AUDIO_BACKPRESSURE", "START_TIMEOUT",
    "TICKET_EXPIRED", "personal_realtime_asr_handshake_failed"].includes(reason);
}

/** Owns retry timers only; the caller serializes and cancels transport startup. */
export class RealtimeReconnect {
  private wanted = false;
  private waiting = false;
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly retry: () => void,
    private readonly exhausted: () => void,
    private readonly isOnline: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false,
  ) {}

  begin() { this.cancel(); this.wanted = true; this.attempts = 0; }
  cancel() {
    this.wanted = false;
    this.waiting = false;
    clearTimeout(this.timer);
    clearTimeout(this.stableTimer);
    this.timer = undefined;
    this.stableTimer = undefined;
  }
  connected() {
    this.waiting = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => { this.attempts = 0; }, 30_000);
  }
  failed(retryable: boolean) {
    if (!this.wanted || this.waiting) return;
    clearTimeout(this.stableTimer);
    if (!retryable || this.attempts >= 5) {
      this.cancel();
      this.exhausted();
      return;
    }
    this.waiting = true;
    this.schedule();
  }
  online() { if (this.wanted && this.waiting) this.schedule(); }
  private schedule() {
    if (this.timer || !this.isOnline()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.wanted || !this.isOnline()) return;
      this.waiting = false;
      this.attempts++;
      this.retry();
    }, Math.min(1000 * 2 ** this.attempts, 8000));
  }
}
