import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { cloneDocument, createWhiteboardDocument, executeCommands, prepareWhiteboardUpdate, readObjects } from '../src';
function seeded(): Y.Doc {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: { id: 'a', kind: 'sticky', schemaVersion: 1, text: '你好', style: {}, geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } } }], {});
  return doc;
}
it('vets an offline concurrent edit without mutating authority, then accepts duplicate replay', () => {
  const server = seeded(), peer = cloneDocument(server);
  executeCommands(server, [{ type: 'text', id: 'a', index: 2, deleteCount: 0, insert: '甲' }], {});
  executeCommands(peer, [{ type: 'text', id: 'a', index: 2, deleteCount: 0, insert: '乙' }], {});
  const before = readObjects(server), incoming = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(server));
  const update = prepareWhiteboardUpdate(server, incoming);
  expect(readObjects(server)).toEqual(before); Y.applyUpdate(server, update);
  expect(readObjects(server)[0].text).toContain('甲'); expect(readObjects(server)[0].text).toContain('乙');
  expect(() => prepareWhiteboardUpdate(server, incoming)).not.toThrow();
});
it('rejects removal and delete-recreation of a tombstone, preserving authority', () => {
  const server = seeded(); executeCommands(server, [{ type: 'delete', id: 'a' }], {});
  const peer = cloneDocument(server); peer.getMap('deletedObjects').delete('a');
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer))).toThrow('TOMBSTONE_CHANGED');
  peer.getMap('deletedObjects').set('a', true);
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer))).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(server)).toEqual([]);
});
it('rejects removal of objects or replacement of text identity', () => {
  const server = seeded(), peer = cloneDocument(server);
  peer.getMap('objects').delete('a');
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer))).toThrow('OBJECT_IDENTITY_REPLACED');
  const other = cloneDocument(server); other.getMap<Y.Map<unknown>>('objects').get('a')!.set('text', new Y.Text('same'));
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(other))).toThrow('FIELD_IDENTITY_REPLACED');
});
it('rejects oversized updates and unresolved causal dependencies', () => {
  const server = createWhiteboardDocument(), peer = createWhiteboardDocument(), updates: Uint8Array[] = [];
  peer.on('update', update => updates.push(update));
  executeCommands(peer, [{ type: 'create', object: readObjects(seeded())[0] }], {});
  executeCommands(peer, [{ type: 'text', id: 'a', index: 2, deleteCount: 0, insert: '甲' }], {});
  expect(() => prepareWhiteboardUpdate(server, updates[1])).toThrow('MISSING_CAUSAL_DEPENDENCY');
  expect(() => prepareWhiteboardUpdate(server, new Uint8Array(65537))).toThrow('UPDATE_LIMIT_EXCEEDED');
  expect(readObjects(server)).toEqual([]);
});
it.each([[100, 200], [200, 100]])('accepts concurrent monotonic deletions with client IDs %s and %s', (firstId, secondId) => {
  const base = seeded(), first = cloneDocument(base), second = cloneDocument(base), vector = Y.encodeStateVector(base);
  first.clientID = firstId; second.clientID = secondId;
  executeCommands(first, [{ type: 'delete', id: 'a' }], {}); executeCommands(second, [{ type: 'delete', id: 'a' }], {});
  const incoming = Y.encodeStateAsUpdate(second, vector), accepted = prepareWhiteboardUpdate(first, incoming);
  Y.applyUpdate(first, accepted); expect(readObjects(first)).toEqual([]);
  expect(() => prepareWhiteboardUpdate(first, incoming)).not.toThrow();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  expect(readObjects(second)).toEqual([]);
});
it('accepts a concurrent winning tombstone even after the peer has merged the losing one', () => {
  const base = seeded(), first = cloneDocument(base), second = cloneDocument(base);
  first.clientID = 100; second.clientID = 200;
  executeCommands(first, [{ type: 'delete', id: 'a' }], {}); executeCommands(second, [{ type: 'delete', id: 'a' }], {});
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  expect(() => prepareWhiteboardUpdate(first, Y.encodeStateAsUpdate(second))).not.toThrow();
});
it('still rejects a false tombstone and an attempted resurrection', () => {
  const server = seeded(); executeCommands(server, [{ type: 'delete', id: 'a' }], {});
  const peer = cloneDocument(server); peer.getMap('deletedObjects').set('a', false);
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer))).toThrow('TOMBSTONE_CHANGED');
  const restored = cloneDocument(server); restored.getMap('deletedObjects').delete('a');
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(restored))).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(server)).toEqual([]);
});
it('rejects a concurrent false tombstone even when it loses to an existing true value', () => {
  const base = seeded(), server = cloneDocument(base), peer = cloneDocument(base);
  server.clientID = 200; peer.clientID = 100;
  executeCommands(server, [{ type: 'delete', id: 'a' }], {});
  peer.getMap('deletedObjects').set('a', false);
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer))).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(server)).toEqual([]);
});
it('rejects a raw peer update that bypasses commands to mutate a locked object', () => {
  const server = seeded();
  server.getMap<Y.Map<unknown>>('objects').get('a')!.set('extensionData', { locked: true });
  const peer = cloneDocument(server), vector = Y.encodeStateVector(server);
  peer.getMap<Y.Map<unknown>>('objects').get('a')!.set('geometry', { x: 90, y: 0, width: 100, height: 100, rotation: 0 });
  expect(() => prepareWhiteboardUpdate(server, Y.encodeStateAsUpdate(peer, vector))).toThrow('OBJECT_LOCKED');
  expect(readObjects(server)[0]!.geometry.x).toBe(0);
  server.destroy(); peer.destroy();
});
