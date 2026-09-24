import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WHITEBOARD_LIMITS } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { WHITEBOARD_SCALE_POLICY } from '../../src/domain/whiteboard-scale-policy';
import { WhiteboardValidationQueue } from '../../src/infrastructure/whiteboard/update-validator';

it('keeps public content limits and host admission limits joined at one policy', () => {
  expect(WHITEBOARD_SCALE_POLICY.document).toMatchObject({
    objects: WHITEBOARD_LIMITS.objects,
    tombstones: WHITEBOARD_LIMITS.tombstones,
    commandsPerBatch: WHITEBOARD_LIMITS.batch,
    encodedBytes: WHITEBOARD_UPDATE_LIMITS.documentBytes,
    structs: WHITEBOARD_UPDATE_LIMITS.documentStructs,
  });
  expect(WHITEBOARD_SCALE_POLICY.update.encodedBytes).toBe(WHITEBOARD_UPDATE_LIMITS.bytes);
  expect(WHITEBOARD_SCALE_POLICY.websocket.frameBytes).toBeGreaterThan(WHITEBOARD_UPDATE_LIMITS.bytes);
  expect(WHITEBOARD_SCALE_POLICY.validator.queuedBytes).toBeGreaterThanOrEqual(WHITEBOARD_UPDATE_LIMITS.documentBytes);
});

it('keeps self-host capacity documentation mechanically aligned with the policy', () => {
  const docs = readFileSync(new URL('../../../../docs/deployment/WHITEBOARD-SELF-HOST.md', import.meta.url), 'utf8');
  for (const value of [
    WHITEBOARD_SCALE_POLICY.document.objects,
    WHITEBOARD_SCALE_POLICY.document.commandsPerBatch,
    WHITEBOARD_SCALE_POLICY.validator.workers,
    WHITEBOARD_SCALE_POLICY.validator.queuedJobs,
  ]) expect(docs).toContain(value.toLocaleString('en-US'));
  expect(docs).toContain(`${WHITEBOARD_SCALE_POLICY.update.encodedBytes / 1024} KiB per`);
  expect(docs).toContain(`${WHITEBOARD_SCALE_POLICY.websocket.frameBytes / 1024} KiB per`);
  expect(docs).toContain(`${WHITEBOARD_SCALE_POLICY.validator.queuedBytes / 1024 / 1024} MiB`);
});

it('rejects a large synthetic burst with bounded active and queued work', async () => {
  let maxActive = 0, maxQueued = 0;
  const queue = new WhiteboardValidationQueue(
    { concurrent: 2, queued: 4, queuedBytes: 4, queueWaitMs: 1000 },
    (active, queued) => { maxActive = Math.max(maxActive, active); maxQueued = Math.max(maxQueued, queued); },
  );
  const active = await Promise.all([queue.acquire(1), queue.acquire(1)]);
  const admitted = Array.from({ length: 4 }, () => queue.acquire(1));
  const rejected = await Promise.allSettled(Array.from({ length: 10_000 }, () => queue.acquire(1)));
  expect(rejected.every(result => result.status === 'rejected')).toBe(true);
  expect(maxActive).toBe(2); expect(maxQueued).toBe(4);
  active.forEach(release => release());
  for (const pending of admitted) (await pending)();
});
