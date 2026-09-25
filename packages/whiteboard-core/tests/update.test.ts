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
// --- Self-undo exception: a principal-authorized actor may resurrect their own recent delete ---
function deletedBySelf(actorId: string, now = Date.now()): { authority: Y.Doc; resurrect: () => Uint8Array; now: number } {
  const base = seeded(), deleter = cloneDocument(base), vector = Y.encodeStateVector(base);
  executeCommands(deleter, [{ type: 'delete', id: 'a' }], {});
  const authority = cloneDocument(base);
  const accepted = prepareWhiteboardUpdate(authority, Y.encodeStateAsUpdate(deleter, vector), actorId, now);
  Y.applyUpdate(authority, accepted);
  return { authority, resurrect: () => { const undone = cloneDocument(authority); undone.getMap('deletedObjects').delete('a'); return Y.encodeStateAsUpdate(undone, Y.encodeStateVector(authority)); }, now };
}
it('allows the same actor to self-undo their own delete within the window', () => {
  const { authority, resurrect, now } = deletedBySelf('alice');
  expect(readObjects(authority)).toEqual([]);
  const accepted = prepareWhiteboardUpdate(authority, resurrect(), 'alice', now + 5_000);
  Y.applyUpdate(authority, accepted);
  expect(readObjects(authority).map(o => o.id)).toEqual(['a']);
});
it('rejects a different actor resurrecting someone else\'s delete', () => {
  const { authority, resurrect, now } = deletedBySelf('alice');
  expect(() => prepareWhiteboardUpdate(authority, resurrect(), 'bob', now + 1_000)).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(authority)).toEqual([]);
});
it('rejects a self-undo once the window has expired', () => {
  const { authority, resurrect, now } = deletedBySelf('alice');
  expect(() => prepareWhiteboardUpdate(authority, resurrect(), 'alice', now + 30_001)).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(authority)).toEqual([]);
});
it('rejects a self-undo when no actorId is supplied at all', () => {
  const { authority, resurrect, now } = deletedBySelf('alice');
  expect(() => prepareWhiteboardUpdate(authority, resurrect(), undefined, now + 1_000)).toThrow('TOMBSTONE_CHANGED');
});
it('rejects a self-undo once the tombstone has changed since the recorded delete', () => {
  const base = seeded(), deleter = cloneDocument(base), vector = Y.encodeStateVector(base);
  deleter.clientID = 1;
  executeCommands(deleter, [{ type: 'delete', id: 'a' }], {});
  const authority = cloneDocument(base);
  const now = Date.now();
  const accepted = prepareWhiteboardUpdate(authority, Y.encodeStateAsUpdate(deleter, vector), 'alice', now);
  Y.applyUpdate(authority, accepted);
  // A different, concurrent delete of the same object (racing with alice's, and winning the
  // Y.Map conflict by client id) is accepted as monotonic (not a resurrection) but changes
  // which tombstone struct is authoritative.
  const other = cloneDocument(base); other.clientID = Number.MAX_SAFE_INTEGER;
  executeCommands(other, [{ type: 'delete', id: 'a' }], {});
  const otherAccepted = prepareWhiteboardUpdate(authority, Y.encodeStateAsUpdate(other, vector), 'carol', now + 1_000);
  Y.applyUpdate(authority, otherAccepted);
  expect(readObjects(authority)).toEqual([]);
  const undone = cloneDocument(authority); undone.getMap('deletedObjects').delete('a');
  expect(() => prepareWhiteboardUpdate(authority, Y.encodeStateAsUpdate(undone, Y.encodeStateVector(authority)), 'alice', now + 2_000)).toThrow('TOMBSTONE_CHANGED');
  expect(readObjects(authority)).toEqual([]);
});
it('rejects a client update that writes directly into the delete-attribution ledger', () => {
  const { authority } = deletedBySelf('alice');
  const tampered = cloneDocument(authority);
  tampered.getMap('deleteAttribution').set('a', { actorId: 'mallory', deletedAt: Date.now(), tombstoneClient: 0, tombstoneClock: 0 });
  expect(() => prepareWhiteboardUpdate(authority, Y.encodeStateAsUpdate(tampered, Y.encodeStateVector(authority)), 'mallory')).toThrow('ATTRIBUTION_TAMPERED');
});
