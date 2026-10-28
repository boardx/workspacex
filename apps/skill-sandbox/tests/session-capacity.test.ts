import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionCapacity } from '../src/execution-capacity.js';
import { SessionManager } from '../src/session/manager.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function latch() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
const input = (executionId: string) => ({ executionId, command: 'trusted-test', timeoutMs: 1000 });

describe('native session capacity integration', () => {
  it('queues across sessions and cancels a waiting command without a provider execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capacity-')); roots.push(root);
    const capacity = new ExecutionCapacity({ concurrency: 1, maxQueue: 2, ownerConcurrency: 1, ownerMaxQueue: 1, queueWaitMs: 1000 });
    const started = latch(); const finish = latch(); const calls: string[] = [];
    const manager = new SessionManager({ probe: async () => true, execute: async work => {
      calls.push(work.executionId); started.release(); await finish.promise;
      return { executionId: work.executionId, exitCode: 0, output: 'ok', truncated: false, timedOut: false, cancelled: false };
    } }, root, capacity);
    const a = await manager.create([], undefined, [], 'a'); const b = await manager.create([], undefined, [], 'b');
    const running = manager.execute(a.sessionId, a.token, input('first')); await started.promise;
    const waiting = manager.execute(b.sessionId, b.token, input('cancelled'));
    await new Promise(resolve => setImmediate(resolve));
    expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 1 });
    expect(manager.cancel(b.sessionId, b.token, 'cancelled')).toEqual({ cancelled: true });
    expect(await waiting).toMatchObject({ cancelled: true });
    expect(capacity.snapshot().queued).toBe(0);
    finish.release(); await running;
    expect(calls).toEqual(['first']);
    expect(await manager.execute(b.sessionId, b.token, input('cancelled'))).toMatchObject({ cancelled: true });
    expect(calls).toEqual(['first']);
    await manager.destroy(a.sessionId, a.token); await manager.destroy(b.sessionId, b.token);
  });

  it('binds owner quota across different sessions and expires queued requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capacity-')); roots.push(root);
    const capacity = new ExecutionCapacity({ concurrency: 2, maxQueue: 3, ownerConcurrency: 1, ownerMaxQueue: 1, queueWaitMs: 30 });
    const started = latch(); const finish = latch(); let calls = 0;
    const manager = new SessionManager({ probe: async () => true, execute: async work => {
      calls++; started.release(); await finish.promise;
      return { executionId: work.executionId, exitCode: 0, output: '', truncated: false, timedOut: false, cancelled: false };
    } }, root, capacity);
    const sessions = await Promise.all([1,2,3].map(() => manager.create([], undefined, [], 'same-user')));
    const [a,b,c] = sessions;
    const running = manager.execute(a!.sessionId, a!.token, input('first')); await started.promise;
    const waiting = manager.execute(b!.sessionId, b!.token, input('second'));
    await new Promise(resolve => setImmediate(resolve));
    await expect(manager.execute(c!.sessionId, c!.token, input('third'))).rejects.toThrow('CAPACITY_OWNER_LIMIT');
    expect(await waiting).toMatchObject({ timedOut: true, cancelled: false });
    expect(calls).toBe(1);
    finish.release(); await running;
    for (const session of sessions) await manager.destroy(session.sessionId, session.token);
  });
});
