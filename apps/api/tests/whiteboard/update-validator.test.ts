import { describe, expect, it, onTestFailed, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WorkerWhiteboardUpdateValidator, WhiteboardValidationQueue, WHITEBOARD_VALIDATOR_LIMITS } from '../../src/infrastructure/whiteboard/update-validator';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
const empty = new Uint8Array([0, 0]);
const create: WhiteboardCommand = { type: 'create', object: { id: 'n', schemaVersion: 1, kind: 'sticky', text: '你好', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } } };
const validator = new WorkerWhiteboardUpdateValidator();
describe('isolated whiteboard Yjs validator', () => {
  it('runs commands and reads diffs in real disposable worker threads', async () => {
    const result = await validator.commands(empty, [create]);
    const doc = createWhiteboardDocument(); Y.applyUpdate(doc, result.snapshot);
    expect(readObjects(doc)[0]?.text).toBe('你好');
    expect(result.objectIds).toEqual(['n']);
    const update = await validator.diff(result.snapshot, Y.encodeStateVector(doc));
    expect(update.byteLength).toBe(2);
    doc.destroy();
  });
  it('accepts an offline edit after isolated raw update validation', async () => {
    const initial = await validator.commands(empty, [create]);
    const peer = createWhiteboardDocument(); Y.applyUpdate(peer, initial.snapshot);
    const before = Y.encodeStateVector(peer);
    executeCommands(peer, [{ type: 'text', id: 'n', index: 2, deleteCount: 0, insert: '协作' }], {});
    const result = await validator.validate(initial.snapshot, Y.encodeStateAsUpdate(peer, before));
    const restored = createWhiteboardDocument(); Y.applyUpdate(restored, result.snapshot);
    expect(result.objectIds).toEqual(['n']);
    expect(readObjects(restored)[0]?.text).toBe('你好协作'); peer.destroy(); restored.destroy();
  });
  it('returns only live object IDs through the isolated validator', async () => {
    const created = await validator.commands(empty, [create]);
    expect(await validator.objectIds(created.snapshot)).toEqual(['n']);
    expect((await validator.objects(created.snapshot)).map(object => object.text)).toEqual(['你好']);
    const removed = await validator.commands(created.snapshot, [{ type: 'delete', id: 'n' }]);
    expect(await validator.objectIds(removed.snapshot)).toEqual([]);
  });
  it('rejects malformed binary and oversize inputs without leaking worker errors', async () => {
    await expect(validator.validate(empty, new Uint8Array([255]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(validator.validate(empty, new Uint8Array(65537))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(validator.diff(empty, new Uint8Array(8193))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('terminates timed-out workers and releases capacity for the next request', async () => {
    await expect(new WorkerWhiteboardUpdateValidator(1).diff(empty)).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    expect(await validator.diff(empty)).toEqual(empty);
  });
});

describe('bounded worker admission', () => {
  it('bounds a fifty-request burst, drains rejected admissions and releases all capacity', async () => {
    let active = 0, queued = 0, peakActive = 0;
    const acquire = WhiteboardValidationQueue.prototype.acquire;
    const spy = vi.spyOn(WhiteboardValidationQueue.prototype, 'acquire').mockImplementation(async function(this: WhiteboardValidationQueue, bytes: number) {
      queued++;
      try {
        const release = await acquire.call(this, bytes);
        queued--; active++; peakActive = Math.max(peakActive, active);
        let released = false;
        return () => { if (!released) { released = true; active--; } release(); };
      } catch (error) { queued--; throw error; }
    });
    const requests = Array.from({ length: 50 }, () => validator.diff(empty));
    const settled = Promise.allSettled(requests);
    onTestFailed(async () => { await settled; spy.mockRestore(); });
    try {
      const outcomes = await settled;
      expect(outcomes).toHaveLength(50);
      for (const result of outcomes) {
        if (result.status === 'fulfilled') expect(result.value).toEqual(empty);
        else expect(result.reason).toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
      }
      expect(peakActive).toBeLessThanOrEqual(WHITEBOARD_VALIDATOR_LIMITS.concurrent);
      expect(active).toBe(0); expect(queued).toBe(0);
      // Burst overload may expire; it must not strand admission slots afterward.
      expect(await validator.diff(empty)).toEqual(empty);
      expect(active).toBe(0); expect(queued).toBe(0);
    } finally { await settled; spy.mockRestore(); }
  }, WHITEBOARD_VALIDATOR_LIMITS.queueWaitMs + 2 * WHITEBOARD_VALIDATOR_LIMITS.timeoutMs + 10_000);

  it('drains fifty real initial-connect validations through four concurrent clients', async () => {
    // This is a worker lifecycle/cleanup check, not a claim that 50 simultaneous
    // cold starts meet the production 10s admission deadline on every CI host.
    // FIFO/count/byte/expiry protections remain in validator-queue.test.ts.
    const outcomes: PromiseSettledResult<Uint8Array>[] = [];
    let cancelled = false;
    let inFlight: Promise<Uint8Array>[] = [];
    onTestFailed(async () => { cancelled = true; await Promise.allSettled(inFlight); });
    try {
      for (let completed = 0; completed < 50 && !cancelled; completed += WHITEBOARD_VALIDATOR_LIMITS.concurrent) {
        inFlight = Array.from({ length: Math.min(WHITEBOARD_VALIDATOR_LIMITS.concurrent, 50 - completed) }, () => validator.diff(empty));
        // Attach handlers to every worker immediately; even a failed batch must
        // drain all workers (including their terminate/release finally blocks).
        const settled = await Promise.allSettled(inFlight);
        outcomes.push(...settled);
        inFlight = [];
        if (settled.some(result => result.status === 'rejected')) break;
      }
      expect(outcomes.filter(result => result.status === 'rejected')).toEqual([]);
      expect(outcomes).toHaveLength(50);
      for (const result of outcomes) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') expect(result.value).toEqual(empty);
      }
    } finally { cancelled = true; await Promise.allSettled(inFlight); }
  // 13 batches each retain the unchanged 5s per-worker timeout. The enclosing
  // test deadline includes worker teardown; it does not change production SLA.
  }, Math.ceil(50 / WHITEBOARD_VALIDATOR_LIMITS.concurrent) * WHITEBOARD_VALIDATOR_LIMITS.timeoutMs + 25_000);
});
