import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionCapacity } from '../src/execution-capacity.js';
const policy = { concurrency: 2, maxQueue: 3, ownerConcurrency: 1, ownerMaxQueue: 1, queueWaitMs: 1000 };
function latch() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
afterEach(() => vi.useRealTimers());

describe('sandbox execution admission', () => {
  it('reserves slots synchronously, bounds each owner and serves another owner while one is busy', async () => {
    const capacity = new ExecutionCapacity(policy);
    const gate = latch(); const started: string[] = [];
    const first = capacity.run('a', async () => { started.push('a1'); await gate.promise; });
    const second = capacity.run('a', async () => { started.push('a2'); });
    await expect(capacity.run('a', async () => { throw new Error('must not execute'); })).rejects.toThrow('CAPACITY_OWNER_LIMIT');
    await capacity.run('b', async () => { started.push('b'); });
    expect(started).toEqual(['a1', 'b']);
    expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 1, rejected: 1 });
    gate.release(); await Promise.all([first, second]);
    expect(started).toEqual(['a1', 'b', 'a2']);
    expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0, completed: 3 });
    expect(JSON.stringify(capacity.snapshot())).not.toContain('ownerKey');
  });

  it('rejects queue overflow before executing and releases capacity on failure', async () => {
    const capacity = new ExecutionCapacity({ ...policy, concurrency: 1, maxQueue: 1 });
    const gate = latch();
    const running = capacity.run('a', () => gate.promise);
    const queued = capacity.run('b', async () => { throw new Error('script failed'); });
    const rejected = vi.fn();
    await expect(capacity.run('c', rejected)).rejects.toThrow('CAPACITY_QUEUE_FULL');
    expect(rejected).not.toHaveBeenCalled();
    const outcome = expect(queued).rejects.toThrow('script failed');
    gate.release(); await running; await outcome;
    await expect(capacity.run('c', async () => 42)).resolves.toBe(42);
    expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0, failed: 1 });
  });

  it('removes cancelled waiters and expired deadlines without ever starting their work', async () => {
    vi.useFakeTimers();
    const capacity = new ExecutionCapacity({ ...policy, concurrency: 1 });
    const gate = latch(); const work = vi.fn(); const abort = new AbortController();
    const running = capacity.run('a', () => gate.promise);
    const cancelled = capacity.run('b', work, { signal: abort.signal });
    const cancellation = expect(cancelled).rejects.toThrow('CAPACITY_CANCELLED'); abort.abort(); await cancellation;
    const expired = capacity.run('c', work, { deadline: Date.now() + 20 });
    const timeout = expect(expired).rejects.toThrow('CAPACITY_WAIT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(21); await timeout;
    expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 0, cancelled: 1, timedOut: 1 });
    gate.release(); await running;
    expect(work).not.toHaveBeenCalled();
  });

  it('does not release a running slot until abort cleanup has finished', async () => {
    const capacity = new ExecutionCapacity({ ...policy, concurrency: 1 });
    const cleanup = latch(); const abort = new AbortController(); let observed = false;
    const running = capacity.run('a', async signal => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { observed = true; resolve(); }, { once: true }));
      await cleanup.promise;
    }, { signal: abort.signal });
    await Promise.resolve();
    const next = vi.fn(async () => 1); const waiting = capacity.run('b', next);
    abort.abort(); await Promise.resolve();
    expect(observed).toBe(true); expect(next).not.toHaveBeenCalled();
    expect(capacity.snapshot().active).toBe(1);
    cleanup.release(); await Promise.all([running, waiting]);
    expect(next).toHaveBeenCalledOnce();
  });
});
