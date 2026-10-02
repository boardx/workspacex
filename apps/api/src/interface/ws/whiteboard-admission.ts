import { WhiteboardCollaborationError } from '../../application/whiteboard/collaboration-ports';
type Job = { start: () => void };
type Shared = { controller: AbortController; promise: Promise<unknown>; waiters: number };
/** Round-robin across authenticated tenants. Running canceled operations retain their slot. */
export class WhiteboardAdmission {
  private queues = new Map<string, Job[]>();
  private active = new Set<string>();
  private running = 0;
  private waiting = 0;
  private shared = new Map<string, Shared>();
  run<T>(tenant: string, work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new WhiteboardCollaborationError('DEPENDENCY_UNAVAILABLE'));
    if (this.waiting >= 512 || (this.queues.get(tenant)?.length ?? 0) >= 128)
      return Promise.reject(new WhiteboardCollaborationError('RATE_LIMITED'));
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const cancel = () => {
        if (!started) {
          const queue = this.queues.get(tenant), index = queue?.indexOf(job) ?? -1;
          if (index >= 0) { queue!.splice(index, 1); this.waiting--; }
          if (!queue?.length) this.queues.delete(tenant);
        }
        signal.removeEventListener('abort', cancel);
        reject(new WhiteboardCollaborationError('DEPENDENCY_UNAVAILABLE'));
        this.drain();
      };
      const job: Job = { start: () => {
        started = true; this.running++; this.active.add(tenant);
        Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject).finally(() => {
          signal.removeEventListener('abort', cancel);
          this.running--; this.active.delete(tenant); this.drain();
        });
      } };
      const queue = this.queues.get(tenant) ?? [];
      queue.push(job); this.queues.set(tenant, queue); this.waiting++;
      signal.addEventListener('abort', cancel, { once: true }); this.drain();
    });
  }
  /** Share only currently executing work. Canceling one waiter cannot cancel another. */
  runShared<T>(tenant: string, key: string, work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new WhiteboardCollaborationError('DEPENDENCY_UNAVAILABLE'));
    const sharedKey = JSON.stringify([tenant, key]);
    let entry = this.shared.get(sharedKey);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      entry = {controller, promise: this.run(tenant, work, controller.signal), waiters: 0};
      this.shared.set(sharedKey, entry);
      const created = entry;
      const clear = () => { if (this.shared.get(sharedKey) === created) this.shared.delete(sharedKey); };
      entry.promise.then(clear, clear);
    }
    const current = entry; current.waiters++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return; settled = true;
        signal.removeEventListener('abort', cancel);
        current.waiters--;
        if (!current.waiters) current.controller.abort();
        action();
      };
      const cancel = () => finish(() => reject(new WhiteboardCollaborationError('DEPENDENCY_UNAVAILABLE')));
      signal.addEventListener('abort', cancel, {once: true});
      current.promise.then(value => finish(() => resolve(value as T)), error => finish(() => reject(error)));
    });
  }
  private drain() {
    for (const [tenant, queue] of this.queues) {
      if (this.running >= 2) return;
      if (this.active.has(tenant)) continue;
      const job = queue.shift()!; this.waiting--;
      this.queues.delete(tenant);
      if (queue.length) this.queues.set(tenant, queue);
      job.start();
    }
  }
}
