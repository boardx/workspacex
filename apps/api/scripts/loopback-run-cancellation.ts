/** Cancellation belongs to a run record, never the reusable thread key. */
export class LoopbackRunCancellation {
  private readonly cancelled = new WeakSet<object>();
  private readonly listeners = new WeakMap<object, Set<() => void>>();

  isCancelled(record: object): boolean { return this.cancelled.has(record); }

  cancel(record: object): void {
    this.cancelled.add(record);
    for (const stop of this.listeners.get(record) ?? []) stop();
    this.listeners.delete(record);
  }

  subscribe(record: object, stop: () => void): () => void {
    if (this.isCancelled(record)) { stop(); return () => {}; }
    const listeners = this.listeners.get(record) ?? new Set();
    listeners.add(stop);
    this.listeners.set(record, listeners);
    return () => listeners.delete(stop);
  }
}
