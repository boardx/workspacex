import { expect, it, vi } from 'vitest';
import { WhiteboardAdmission } from '../../src/interface/ws/whiteboard-admission';
const signal = () => new AbortController();
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it('admits a benign tenant while fifty noisy board sessions are queued', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), order: number[] = [];
  const noisy = Array.from({length: 50}, (_, index) => gate.run('noisy', async () => { order.push(index); if (!index) await blocked.promise; }, signal().signal));
  await gate.run('benign', async () => { expect(order).toEqual([0]); }, signal().signal);
  blocked.resolve(); await Promise.all(noisy); expect(order).toHaveLength(50);
});
it('removes disconnected queued work before database entry', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), controller = signal(), database = vi.fn();
  const first = gate.run('org', () => blocked.promise, signal().signal);
  const queued = gate.run('org', database, controller.signal);
  controller.abort(); await expect(queued).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  blocked.resolve(); await first; await Promise.resolve(); expect(database).not.toHaveBeenCalled();
});
it('keeps the occupied slot until canceled running database work settles', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), controller = signal(), database = vi.fn(async () => undefined);
  const running = gate.run('org', () => blocked.promise, controller.signal);
  await Promise.resolve(); controller.abort(); await expect(running).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  const next = gate.run('org', database, signal().signal);
  await Promise.resolve(); expect(database).not.toHaveBeenCalled(); blocked.resolve(); await next; expect(database).toHaveBeenCalledOnce();
});

it('bounds total concurrency at two across fifty distinct tenants', async () => {
  const gate = new WhiteboardAdmission(); let active = 0, maximum = 0, completed = 0;
  await Promise.all(Array.from({length:50}, (_, index) => gate.run(String(index), async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--; completed++;
  }, signal().signal)));
  expect(maximum).toBe(2); expect(completed).toBe(50);
});
