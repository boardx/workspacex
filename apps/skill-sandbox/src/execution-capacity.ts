import { capacityErrors as C } from './session/schema.js';
export interface CapacityPolicy {
  concurrency: number;
  maxQueue: number;
  ownerConcurrency: number;
  ownerMaxQueue: number;
  queueWaitMs: number;
}
export type CapacityCode = string;
export class CapacityError extends Error {
  constructor(readonly code: CapacityCode) { super(code); }
}
interface Waiter {
  owner: string;
  start(): void;
  reject(error: CapacityError): void;
}

/** Per service process, not a durable task queue. Never retries submitted work. */
export class ExecutionCapacity {
  private active = 0;
  private readonly owners = new Map<string, number>();
  private readonly queue: Waiter[] = [];
  private readonly counters = { completed: 0, failed: 0, rejected: 0, timedOut: 0, cancelled: 0, totalWaitMs: 0 };
  constructor(readonly policy: Readonly<CapacityPolicy>) {
    for (const value of Object.values(policy)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_CAPACITY_POLICY');
    if (policy.ownerConcurrency > policy.concurrency || policy.ownerMaxQueue > policy.maxQueue) throw new Error('INVALID_CAPACITY_POLICY');
    this.policy = Object.freeze({ ...policy });
  }

  snapshot() { return { ...this.policy, active: this.active, queued: this.queue.length, ...this.counters }; }

  run<T>(owner: string, work: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; deadline?: number } = {}): Promise<T> {
    const signal = options.signal ?? new AbortController().signal;
    const enqueuedAt = Date.now();
    if (signal.aborted) { this.counters.cancelled++; return Promise.reject(new CapacityError(C.cancelled)); }
    if (options.deadline !== undefined && options.deadline <= enqueuedAt) {
      this.counters.timedOut++; return Promise.reject(new CapacityError(C.waitTimeout));
    }
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const waiter: Waiter = {
        owner,
        reject: error => {
          const index = this.queue.indexOf(waiter);
          if (index < 0) return;
          this.queue.splice(index, 1); cleanup();
          if (error.code === C.cancelled) this.counters.cancelled++;
          else this.counters.timedOut++;
          reject(error); this.drain();
        },
        start: () => {
          cleanup();
          if (signal.aborted || options.deadline !== undefined && options.deadline <= Date.now()) {
            const cancelled = signal.aborted;
            this.counters[cancelled ? 'cancelled' : 'timedOut']++;
            reject(new CapacityError(cancelled ? C.cancelled : C.waitTimeout)); return;
          }
          this.active++;
          this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1);
          this.counters.totalWaitMs += Date.now() - enqueuedAt;
          Promise.resolve().then(async () => {
            try { const value = await work(signal); this.counters.completed++; return value; }
            catch (error) { this.counters.failed++; throw error; }
            finally {
              this.active--;
              const remaining = (this.owners.get(owner) ?? 1) - 1;
              if (remaining) this.owners.set(owner, remaining); else this.owners.delete(owner);
              this.drain();
            }
          }).then(resolve, reject);
        },
      };
      const abort = () => waiter.reject(new CapacityError(C.cancelled));
      if (this.available(owner)) { waiter.start(); return; }
      if (this.queue.filter(item => item.owner === owner).length >= this.policy.ownerMaxQueue) {
        this.counters.rejected++; reject(new CapacityError(C.ownerLimit)); return;
      }
      if (this.queue.length >= this.policy.maxQueue) {
        this.counters.rejected++; reject(new CapacityError(C.queueFull)); return;
      }
      this.queue.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
      const waitMs = Math.min(this.policy.queueWaitMs, (options.deadline ?? Infinity) - Date.now());
      timer = setTimeout(() => waiter.reject(new CapacityError(C.waitTimeout)), Math.max(0, waitMs));
    });
  }

  private available(owner: string) {
    return this.active < this.policy.concurrency && (this.owners.get(owner) ?? 0) < this.policy.ownerConcurrency;
  }
  private drain() {
    while (this.active < this.policy.concurrency) {
      const index = this.queue.findIndex(item => this.available(item.owner));
      if (index < 0) return;
      this.queue.splice(index, 1)[0]!.start();
    }
  }
}
