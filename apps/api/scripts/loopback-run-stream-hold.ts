/** A bounded, opt-in live window shared by stream EOF and status reads. */
export class LoopbackRunStreamHold {
  private readonly deadlines = new WeakMap<object, number>();
  constructor(private readonly configuredMs: number) {}

  start(record: object): void {
    if (this.deadlines.has(record)) return;
    const duration = Number.isFinite(this.configuredMs) ? Math.min(60_000, Math.max(0, this.configuredMs)) : 0;
    this.deadlines.set(record, Date.now() + duration);
  }

  elapsed(record: object): boolean {
    return this.configuredMs > 0 && Number.isFinite(this.configuredMs) && this.deadlines.has(record) && !this.active(record);
  }

  active(record: object): boolean { return Date.now() < (this.deadlines.get(record) ?? 0); }
}
