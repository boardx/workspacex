/** Execution-local negative admission facts only. No excerpts, URLs, model
 * output or persisted state enter this bounded digest set. */
export class NegativeSourceScreenCache {
  private readonly entries = new Set<string>();
  constructor(private readonly capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 512) throw new RangeError("Invalid negative screening cache capacity");
  }
  has(key: string): boolean { return this.entries.has(key); }
  remember(key: string): void {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError("Negative screening cache requires a digest");
    this.entries.delete(key);
    this.entries.add(key);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.values().next().value!);
  }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
