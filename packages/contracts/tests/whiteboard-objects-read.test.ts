import { describe, expect, it } from 'vitest';
import { WHITEBOARD_LIMITS } from '../src/whiteboard-document';
import { WhiteboardObjectsQuery, WhiteboardObjectsSnapshot, whiteboardOperationOperations } from '../src/whiteboard-operation';
const object = { id: 'note', schemaVersion: 1, kind: 'sticky', geometry: { x: 10, y: 20, width: 200, height: 100, rotation: 0 }, text: 'Agent readable', style: {}, parentId: null, orderKey: 'a' };
const snapshot = { boardId: '00000000-0000-4000-8000-000000000001', revision: { epoch: 3, seq: 7 }, role: 'viewer', archived: true, objects: [object] };
describe('canonical Board objects Read contract', () => {
  it('exposes a versioned GET with explicit delegated actor and full canonical response', () => {
    expect(whiteboardOperationOperations.readObjects).toMatchObject({ method: 'GET', path: '/v1/whiteboards/:boardId/objects' });
    expect(WhiteboardObjectsQuery.parse({ actorId: 'agent' })).toEqual({ actorId: 'agent' });
    expect(WhiteboardObjectsSnapshot.parse(snapshot)).toMatchObject(snapshot);
  });
  it('rejects missing actor, spoofed scopes and storage manifests', () => {
    expect(WhiteboardObjectsQuery.safeParse({}).success).toBe(false);
    expect(WhiteboardObjectsQuery.safeParse({ actorId: 'agent', scopes: ['board:read'] }).success).toBe(false);
    expect(WhiteboardObjectsSnapshot.safeParse({ ...snapshot, objectKey: 'private/snapshot.yjs' }).success).toBe(false);
  });
  it('uses the canonical object-count limit without a silent first-page truncation', () => {
    expect(WhiteboardObjectsSnapshot.safeParse({ ...snapshot, objects: Array.from({ length: WHITEBOARD_LIMITS.objects }, (_, i) => ({ ...object, id: `note-${i}` })) }).success).toBe(true);
    expect(WhiteboardObjectsSnapshot.safeParse({ ...snapshot, objects: Array(WHITEBOARD_LIMITS.objects + 1).fill(object) }).success).toBe(false);
  });
});
