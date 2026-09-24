import { performance } from 'node:perf_hooks';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, selectVisibleObjects, validateDocument, type WhiteboardObject } from '../src/index';

const COUNT = 10_000, BATCH = 200;
const elapsed = async <T>(fn: () => T | Promise<T>): Promise<[T, number]> => {
  const started = performance.now(); const value = await fn(); return [value, performance.now() - started];
};
const object = (index: number): WhiteboardObject => ({ id: `scale-${index}`, schemaVersion: 1, kind: 'sticky',
  geometry: { x: (index % 100) * 300, y: Math.floor(index / 100) * 220, width: 180, height: 140, rotation: 0 },
  text: `便签 ${index}`, style: {}, parentId: null, orderKey: String(index).padStart(5, '0') });

const heapBefore = process.memoryUsage().heapUsed;
const authority = createWhiteboardDocument();
const [, fixtureMs] = await elapsed(() => {
  for (let offset = 0; offset < COUNT; offset += BATCH) {
    const shard = createWhiteboardDocument();
    executeCommands(shard, Array.from({ length: BATCH }, (_, i) => ({ type: 'create' as const, object: object(offset + i) })), 'fixture');
    Y.applyUpdate(authority, Y.encodeStateAsUpdate(shard)); shard.destroy();
  }
  validateDocument(authority);
});
const [objects, readMs] = await elapsed(() => readObjects(authority));
const [visible, viewportMs] = await elapsed(() => selectVisibleObjects(objects, { x: 0, y: 0, width: 1280, height: 720 }));
const [selection, selectionMs] = await elapsed(() => objects.filter(item => item.geometry.x >= 6000 && item.geometry.x <= 9000 && item.geometry.y >= 4000 && item.geometry.y <= 7000));
const [snapshot, syncEncodeMs] = await elapsed(() => Y.encodeStateAsUpdate(authority));
const replica = createWhiteboardDocument();
const [, syncApplyMs] = await elapsed(() => Y.applyUpdate(replica, snapshot));
const vector = Y.encodeStateVector(replica);
const [, editMs] = await elapsed(() => executeCommands(authority, [{ type: 'text', id: 'scale-5000', index: 0, deleteCount: 0, insert: '已编辑 ' }], 'scale-edit'));
const [reconnect, reconnectEncodeMs] = await elapsed(() => Y.encodeStateAsUpdate(authority, vector));
const [, reconnectApplyMs] = await elapsed(() => Y.applyUpdate(replica, reconnect));
const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
const measurements = { objectCount: objects.length, visibleCount: visible.length, selectionCount: selection.length,
  snapshotBytes: snapshot.byteLength, reconnectBytes: reconnect.byteLength, heapDeltaMiB,
  fixtureMs, readMs, viewportMs, selectionMs, editMs, syncEncodeMs, syncApplyMs, reconnectEncodeMs, reconnectApplyMs };
const guardrails = { objectCount: COUNT, maxVisibleCount: 200, maxFixtureMs: 30_000, maxReadMs: 2_000,
  maxViewportMs: 250, maxSelectionMs: 250, maxEditMs: 10_000, maxSyncMs: 5_000, maxHeapDeltaMiB: 512 };
const passed = measurements.objectCount === guardrails.objectCount && measurements.visibleCount <= guardrails.maxVisibleCount
  && fixtureMs <= guardrails.maxFixtureMs && readMs <= guardrails.maxReadMs && viewportMs <= guardrails.maxViewportMs
  && selectionMs <= guardrails.maxSelectionMs && editMs <= guardrails.maxEditMs
  && Math.max(syncEncodeMs, syncApplyMs, reconnectEncodeMs, reconnectApplyMs) <= guardrails.maxSyncMs
  && heapDeltaMiB <= guardrails.maxHeapDeltaMiB && readObjects(replica).find(item => item.id === 'scale-5000')?.text.startsWith('已编辑 ') === true;
process.stdout.write(`${JSON.stringify({ kind: 'whiteboard-pure-scale-harness', environment: { node: process.version, platform: process.platform, arch: process.arch }, guardrails, measurements, passed }, null, 2)}\n`);
authority.destroy(); replica.destroy();
if (!passed) process.exitCode = 1;
