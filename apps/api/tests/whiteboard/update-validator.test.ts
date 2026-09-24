import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
const empty = new Uint8Array([0, 0]);
const create: WhiteboardCommand = { type: 'create', object: { id: 'n', schemaVersion: 1, kind: 'sticky', text: '你好', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } } };
const validator = new WorkerWhiteboardUpdateValidator();
describe('isolated whiteboard Yjs validator', () => {
  it('runs commands and reads diffs in real disposable worker threads', async () => {
    const result = await validator.commands(empty, [create]);
    const doc = createWhiteboardDocument(); Y.applyUpdate(doc, result.snapshot);
    expect(readObjects(doc)[0]?.text).toBe('你好');
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
    expect(readObjects(restored)[0]?.text).toBe('你好协作'); peer.destroy(); restored.destroy();
  });
  it('returns only live object IDs through the isolated validator', async () => {
    const created = await validator.commands(empty, [create]);
    expect(await validator.objectIds(created.snapshot)).toEqual(['n']);
    expect((await validator.objects(created.snapshot)).map(object => object.text)).toEqual(['你好']);
    const removed = await validator.commands(created.snapshot, [{ type: 'delete', id: 'n' }]);
    expect(await validator.objectIds(removed.snapshot)).toEqual([]);
  });
  it('rebuilds a legal large history snapshot without applying the client single-update limit',async()=>{
    const objects=Array.from({length:100},(_,index)=>({...create.object,id:`large-${index}`,text:`${index}:`+'x'.repeat(1000)}));
    expect(Buffer.byteLength(JSON.stringify(objects.map(object=>({type:'create',object}))))).toBeLessThan(262144);
    const snapshot=await validator.rebuild(objects),restored=createWhiteboardDocument();Y.applyUpdate(restored,snapshot);
    expect(readObjects(restored)).toHaveLength(100);expect(snapshot.byteLength).toBeGreaterThan(65536);restored.destroy();
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
  it('serves fifty small initial-connect validations with four running workers', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => validator.diff(empty)));
    expect(results).toHaveLength(50); for (const result of results) expect(result).toEqual(empty);
  });
});
