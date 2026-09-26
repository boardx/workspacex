import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createWhiteboardDocument,
  duplicateWhiteboardSnapshot,
  executeCommands,
  readObjects,
  validateDocument,
  type WhiteboardObject,
} from '../src';

const geometry = { x: 0, y: 0, width: 120, height: 80, rotation: 0 };
const object = (id: string, kind: WhiteboardObject['kind'] = 'sticky'): WhiteboardObject => ({
  id, schemaVersion: 1, kind, geometry, text: id, style: {}, parentId: null, orderKey: id,
  ...(kind === 'connector' ? { connector: { from: 'child', to: 'peer' } } : {}),
});

function sourceDocument(): Y.Doc {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [
    { type: 'create', object: object('frame', 'frame') },
    { type: 'create', object: { ...object('child'), parentId: 'frame' } },
    { type: 'create', object: object('peer') },
    { type: 'create', object: object('edge', 'connector') },
    { type: 'create', object: object('deleted') },
  ], 'source');
  executeCommands(doc, [{ type: 'delete', id: 'deleted' }], 'source');
  return doc;
}

describe('duplicateWhiteboardSnapshot', () => {
  it('gives every live object a fresh id and remaps parents and connector endpoints', () => {
    const source = sourceDocument();
    const result = duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(source), id => `copy_${id}`);
    const target = createWhiteboardDocument();
    Y.applyUpdate(target, result.snapshot);

    expect(readObjects(target)).toEqual([
      expect.objectContaining({ id: 'copy_child', parentId: 'copy_frame' }),
      expect.objectContaining({ id: 'copy_edge', connector: { from: 'copy_child', to: 'copy_peer' } }),
      expect.objectContaining({ id: 'copy_frame', parentId: null }),
      expect.objectContaining({ id: 'copy_peer', parentId: null }),
    ]);
    expect(result).toMatchObject({ objectCount: 4, connectorCount: 1, assetCount: 0 });
    expect(readObjects(target).some(item => item.id === 'copy_deleted')).toBe(false);
    validateDocument(target);
    source.destroy(); target.destroy();
  });

  it('builds an independent Y.Doc whose later edits do not cross either direction', () => {
    const source = sourceDocument();
    const sourceBefore = Y.encodeStateAsUpdate(source);
    const result = duplicateWhiteboardSnapshot(sourceBefore, id => `new_${id}`);
    const target = createWhiteboardDocument();
    Y.applyUpdate(target, result.snapshot);

    executeCommands(source, [{ type: 'text', id: 'child', index: 5, deleteCount: 0, insert: '-source' }], 'source');
    expect(readObjects(target).find(item => item.id === 'new_child')?.text).toBe('child');
    executeCommands(target, [{ type: 'text', id: 'new_child', index: 5, deleteCount: 0, insert: '-target' }], 'target');
    expect(readObjects(source).find(item => item.id === 'child')?.text).toBe('child-source');
    expect(Y.encodeStateVector(target)).not.toEqual(Y.encodeStateVector(source));
    source.destroy(); target.destroy();
  });

  it.each([
    ['same id', (id: string) => id, 'DUPLICATE_ID_NOT_FRESH'],
    ['colliding ids', () => 'same', 'DUPLICATE_ID_COLLISION'],
    ['invalid ids', (id: string) => `copy:${id}`, 'INVALID_DUPLICATE_ID'],
  ])('rejects %s without returning a partial snapshot', (_label, newId, message) => {
    const source = sourceDocument();
    expect(() => duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(source), newId)).toThrow(message);
    source.destroy();
  });

  it('fails the whole copy for a live connector whose endpoint is deleted', () => {
    const source = sourceDocument();
    executeCommands(source, [{ type: 'delete', id: 'peer' }], 'source');
    expect(() => duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(source), id => `new_${id}`)).toThrow('INVALID_DUPLICATE_REFERENCE');
    source.destroy();
  });

  it.each([
    { related: 'peer' },
    { reference: 'external-object' },
    { relatedObjectId: 'external-object' },
    { nested: [{ targetObjectIds: ['peer'] }] },
  ])('fails closed for opaque extension references: %j', extensionData => {
    const source = sourceDocument();
    executeCommands(source, [{ type: 'create', object: { ...object('plugin', 'extension'), extensionData } }], 'source');
    expect(() => duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(source), id => `new_${id}`)).toThrow('UNSUPPORTED_EXTENSION_REFERENCE');
    source.destroy();
  });

  it('preserves bounded extension data that provably contains no board-object reference', () => {
    const source = sourceDocument();
    executeCommands(source, [{ type: 'create', object: { ...object('plugin', 'extension'), extensionData: { colorToken: 'violet', weight: 2 } } }], 'source');
    const target = createWhiteboardDocument();
    const result = duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(source), id => `new_${id}`);
    Y.applyUpdate(target, result.snapshot);
    expect(readObjects(target).find(item => item.id === 'new_plugin')?.extensionData).toEqual({ colorToken: 'violet', weight: 2 });
    source.destroy(); target.destroy();
  });
});
