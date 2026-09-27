import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { WHITEBOARD_LIMITS, WhiteboardCommandBatch, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_OPERATION_LIMITS, WhiteboardOperationRequest } from '@repo/contracts/whiteboard-operation';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from '../../src/infrastructure/whiteboard/update-validator';

const objectMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects');
const acceptanceCount = 10_000;
// Public operation count and canonical count are separate ceilings; full create
// payloads must also fit the worker transport byte budget.
const normalBatchSize = Math.min(WHITEBOARD_OPERATION_LIMITS.commands, WHITEBOARD_LIMITS.batch);
const object = (index: number) => ({ id: `capacity-${index}`, schemaVersion: 1 as const, kind: 'sticky' as const,
  geometry: { x: index % 100 * 240, y: Math.floor(index / 100) * 180, width: 220, height: 160, rotation: 0 },
  text: `研究观察 ${index}: a real canonical note with bounded text`, style: { fill: '#f8d76e', fontSize: 18 }, parentId: null, orderKey: String(index).padStart(5, '0') });
function document(count: number) {
  const doc = createWhiteboardDocument();
  // Build wire data without calling the validator under test, including the
  // deliberately oversized fixture. These are the same canonical shared types.
  doc.transact(() => {
    for (let index = 0; index < count; index++) {
      const { id, text, style, ...fields } = object(index);
      const item = new Y.Map<unknown>(Object.entries(fields));
      item.set('text', new Y.Text(text)); item.set('style', new Y.Map<unknown>(Object.entries(style)));
      objectMap(doc).set(id, item);
    }
  });
  return doc;
}
const validator = new WorkerWhiteboardUpdateValidator();
let full: Uint8Array, oversized: Uint8Array, beforeLastBatch: Uint8Array, edit: Uint8Array;
const metrics: Record<string, number> = {};
beforeAll(() => {
  const doc = document(acceptanceCount);
  full = Y.encodeStateAsUpdate(doc);
  metrics.snapshotBytes = full.byteLength;
  metrics.documentStructs = [...doc.store.clients.values()].reduce((sum, values) => sum + values.length, 0);
  const vector = Y.encodeStateVector(doc);
  (objectMap(doc).get('capacity-0')!.get('text') as Y.Text).insert(0, 'Updated ');
  edit = Y.encodeStateAsUpdate(doc, vector); doc.destroy();
  for (const count of [acceptanceCount + 1, acceptanceCount - normalBatchSize]) {
    const candidate = document(count), bytes = Y.encodeStateAsUpdate(candidate); candidate.destroy();
    if (count > acceptanceCount) oversized = bytes; else beforeLastBatch = bytes;
  }
});
async function measured<T>(name: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); } finally { metrics[name] = Math.round(performance.now() - started); console.info('whiteboard-capacity', JSON.stringify(metrics)); }
}

describe('10k canonical board in real resource-limited validator workers', () => {
  it('decodes all 10000 complete canonical objects under bounded worker budgets', async () => {
    expect(WHITEBOARD_LIMITS.objects).toBe(acceptanceCount);
    const objects = await measured('decodeMs', () => validator.objects(full));
    expect(objects).toHaveLength(acceptanceCount);
    expect(objects[0]).toMatchObject(object(0)); expect(objects.at(-1)).toMatchObject(object(acceptanceCount - 1));
    expect(metrics.snapshotBytes).toBeLessThan(WHITEBOARD_UPDATE_LIMITS.documentBytes);
    expect(metrics.documentStructs).toBeLessThan(WHITEBOARD_UPDATE_LIMITS.documentStructs);
    expect(metrics.decodeMs).toBeLessThan(WHITEBOARD_VALIDATOR_LIMITS.timeoutMs);
  });
  it('validates a real incremental text edit on a 10000-object document', async () => {
    const accepted = await measured('validateMs', () => validator.validate(full, edit));
    const objects = await validator.objects(accepted.snapshot);
    expect(objects).toHaveLength(acceptanceCount);
    expect(objects[0]!.text).toBe(`Updated ${object(0).text}`);
  });
  it('admits the final normal-sized command batch up to 10000 and rejects one object beyond it', async () => {
    const commands: WhiteboardCommand[] = Array.from({ length: normalBatchSize }, (_, offset) => ({ type: 'create', object: object(acceptanceCount - normalBatchSize + offset) }));
    expect(Buffer.byteLength(JSON.stringify(commands))).toBeLessThanOrEqual(WHITEBOARD_VALIDATOR_LIMITS.commandBytes);
    const accepted = await measured('commandsMs', () => validator.commands(beforeLastBatch, commands));
    expect(await validator.objectIds(accepted.snapshot)).toHaveLength(acceptanceCount);
    await expect(validator.commands(accepted.snapshot, [{ type: 'create', object: object(acceptanceCount) }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rejects an oversized persisted document on read, diff and raw-update validation', async () => {
    for (const operation of [() => validator.objects(oversized), () => validator.diff(oversized), () => validator.validate(oversized, new Uint8Array([0, 0]))]) {
      await expect(operation()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
  it('retains bounded command, update, snapshot and heap limits', async () => {
    const maximumBatch: WhiteboardCommand[] = Array.from({length: WHITEBOARD_LIMITS.batch}, () => ({type: 'delete', id: 'capacity-0'}));
    expect(WhiteboardCommandBatch.safeParse(maximumBatch).success).toBe(true);
    expect(WhiteboardCommandBatch.safeParse([...maximumBatch, maximumBatch[0]!]).success).toBe(false);
    expect(WHITEBOARD_OPERATION_LIMITS.commands).toBeLessThan(WHITEBOARD_LIMITS.batch);
    expect(WhiteboardOperationRequest.shape.commands.safeParse(maximumBatch.slice(0, WHITEBOARD_OPERATION_LIMITS.commands)).success).toBe(true);
    expect(WhiteboardOperationRequest.shape.commands.safeParse(maximumBatch.slice(0, WHITEBOARD_OPERATION_LIMITS.commands + 1)).success).toBe(false);
    expect(WHITEBOARD_VALIDATOR_LIMITS.workerHeapMb * WHITEBOARD_VALIDATOR_LIMITS.concurrent).toBe(512); expect(WHITEBOARD_VALIDATOR_LIMITS.timeoutMs).toBe(5000);
    await expect(validator.commands(full, Array.from({ length: WHITEBOARD_LIMITS.batch + 1 }, () => ({ type: 'delete', id: 'capacity-0' })))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Valid canonical count does not override the independent JSON byte ceiling.
    const byteOversized: WhiteboardCommand[] = Array.from({length: WHITEBOARD_LIMITS.batch}, (_, i) => ({type: 'create', object: object(i)}));
    expect(WhiteboardCommandBatch.safeParse(byteOversized).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(byteOversized))).toBeGreaterThan(WHITEBOARD_VALIDATOR_LIMITS.commandBytes);
    await expect(validator.commands(full, byteOversized)).rejects.toMatchObject({code: 'VALIDATION_FAILED'});
    await expect(validator.validate(full, new Uint8Array(WHITEBOARD_UPDATE_LIMITS.bytes + 1))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(validator.objects(new Uint8Array(WHITEBOARD_UPDATE_LIMITS.documentBytes + 1))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
