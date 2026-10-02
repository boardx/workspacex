import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, duplicateWhiteboardSnapshot, executeCommands, readObjects } from '../src';

function fixture(id: string, metadata: unknown) {
  const doc = createWhiteboardDocument();
  const object = { schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: 10, y: 20, width: 180, height: 180, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: '' };
  executeCommands(doc, [
    { type: 'create', object: { ...object, id } },
    { type: 'create', object: { ...object, id: 'note', extensionData: { thinkingInput: metadata } } },
  ], 'fixture');
  return doc;
}

it.each([
  { id: 'body', metadata: { text: { preset: 'body' } } },
  { id: 'square', metadata: { sticky: { variant: 'square', sizing: 'fixed', color: '#FFE99A' } } },
])('copies typed metadata when its legitimate value matches object id $id', ({ id, metadata }) => {
  const source = fixture(id, metadata), target = createWhiteboardDocument();
  try {
    const before = Y.encodeStateAsUpdate(source);
    const result = duplicateWhiteboardSnapshot(before, old => `copy_${old}`);
    Y.applyUpdate(target, result.snapshot);
    expect(result.objectCount).toBe(2);
    expect(readObjects(target).map(object => object.id)).toEqual([`copy_${id}`, 'copy_note'].sort());
    expect(readObjects(target).find(object => object.id === 'copy_note')!.extensionData).toEqual({ thinkingInput: metadata });
    expect(Y.encodeStateAsUpdate(source)).toEqual(before);
  } finally { source.destroy(); target.destroy(); }
});

it.each([
  { text: { preset: 'body' }, sourceId: 'external' },
  { text: { preset: 'body', targetObjectId: 'external' } },
  { sticky: { variant: 'square', sizing: 'fixed', color: '#FFE99A', related: 'external' } },
  { text: { preset: 'body', bold: 'body' } },
  { text: { preset: 'body', italic: 'body' } },
  { text: { preset: 'body', underline: 'body' } },
  { sticky: { variant: 'body', sizing: 'fixed', color: '#FFE99A' } },
  { unknown: { nested: ['body'] } },
])('retains opaque-reference rejection for unknown or malformed metadata %j', metadata => {
  const source = fixture('body', metadata);
  try {
    const before = Y.encodeStateAsUpdate(source);
    expect(() => duplicateWhiteboardSnapshot(before, old => `copy_${old}`)).toThrow('UNSUPPORTED_EXTENSION_REFERENCE');
    expect(Y.encodeStateAsUpdate(source)).toEqual(before);
  } finally { source.destroy(); }
});
