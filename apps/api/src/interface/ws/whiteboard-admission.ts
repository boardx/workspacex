import { WhiteboardCollaborationError } from '../../application/whiteboard/collaboration-ports';
type Job = { start: () => void };
/** Round-robin across authenticated tenants. Running canceled operations retain their slot. */
export class WhiteboardAdmission {
  private queues = new Map<string, Job[]>();
  private active = new Set<string>();
  private running = 0;
  private waiting = 0;
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
