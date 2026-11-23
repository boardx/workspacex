/** Retain failed terminal deliveries while the provider instance is alive. */
export class PendingCreditReceipts {
  private readonly pending = new Set<() => Promise<void>>();
  private recovery?: Promise<boolean>;

  retain(deliver: () => Promise<void>): void {
    this.pending.add(deliver);
  }

  recover(): Promise<boolean> {
    if (this.recovery) return this.recovery;
    if (this.pending.size === 0) return Promise.resolve(true);

    this.recovery = Promise.allSettled([...this.pending].map(async deliver => {
      await deliver();
      this.pending.delete(deliver);
    })).then(() => this.pending.size === 0).finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }
}
