import { expect, it, vi } from 'vitest';
import { WhiteboardValidationQueue } from '../../src/infrastructure/whiteboard/update-validator';
it('queues FIFO without increasing active concurrency and releases slots exactly once', async () => {
  const queue = new WhiteboardValidationQueue({ concurrent: 1, queued: 2, queuedBytes: 10, queueWaitMs: 1000 });
  const first = await queue.acquire(1), order: number[] = [];
  const second = queue.acquire(4).then(release => { order.push(2); return release; });
  const third = queue.acquire(4).then(release => { order.push(3); return release; });
  await expect(queue.acquire(1)).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
  expect(order).toEqual([]); first(); first(); const releaseSecond = await second;
  expect(order).toEqual([2]); releaseSecond(); (await third)(); expect(order).toEqual([2, 3]);
});
it('bounds queued bytes independently of queued item count', async () => {
  const queue = new WhiteboardValidationQueue({ concurrent: 1, queued: 20, queuedBytes: 8, queueWaitMs: 1000 });
  const first = await queue.acquire(1), second = queue.acquire(8);
  await expect(queue.acquire(1)).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
  first(); (await second)();
});
it('expires queued work and reclaims its byte and count budgets', async () => {
  vi.useFakeTimers();
  try {
    const queue = new WhiteboardValidationQueue({ concurrent: 1, queued: 1, queuedBytes: 8, queueWaitMs: 25 });
    const first = await queue.acquire(1), pending = queue.acquire(8);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(26); await rejection;
    const next = queue.acquire(8); first(); (await next)();
  } finally { vi.useRealTimers(); }
});
