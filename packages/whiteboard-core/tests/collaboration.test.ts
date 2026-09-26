import { describe, expect, it } from 'vitest';
import { WhiteboardCommentService, WhiteboardPresenceRegistry, checkpointHash, restoredHead, verifyCheckpoint } from '../src';

const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'];
const boardId = '20000000-0000-4000-8000-000000000001';
function fixture() {
  let at = 0;
  const objects = new Set(['note']);
  const service = new WhiteboardCommentService(boardId, {
    objectExists: id => objects.has(id), isMentionable: id => ['owner', 'editor', 'viewer'].includes(id),
    now: () => new Date('2026-09-26T00:00:00.000Z'), uuid: () => ids[at++]!,
  });
  return { service, objects };
}

describe('whiteboard object comments', () => {
  it('lets every member comment and reply with stable identity, CAS and idempotency', () => {
    const { service } = fixture();
    const create = { type: 'create-comment' as const, requestId: ids[0], threadId: ids[1], commentId: ids[2], objectId: 'note', body: '问题', mentions: [{ userId: 'editor' }], expectedRevision: 0 as const };
    const accepted = service.dispatch({ actorId: 'viewer', role: 'viewer' }, create);
    expect(accepted.events[0]).toMatchObject({ type: 'CommentCreated', objectId: 'note' });
    expect(service.dispatch({ actorId: 'viewer', role: 'viewer' }, create)).toMatchObject({ replayed: true, operationId: accepted.operationId });
    expect(() => service.dispatch({ actorId: 'viewer', role: 'viewer' }, { ...create, body: 'changed' })).toThrow('IDEMPOTENCY_CONFLICT');
    const reply = service.dispatch({ actorId: 'editor', role: 'editor' }, { type: 'reply', requestId: ids[3], threadId: ids[1], commentId: ids[4], body: '回答', mentions: [], expectedRevision: 1 });
    expect(reply.threads[0]).toMatchObject({ revision: 2, comments: [{ id: ids[2] }, { id: ids[4], parentCommentId: ids[2] }] });
    expect(() => service.dispatch({ actorId: 'editor', role: 'editor' }, { type: 'resolve', requestId: ids[5], threadId: ids[1], resolved: true, expectedRevision: 1 })).toThrow('COMMENT_CONFLICT');
  });

  it('enforces resolve/delete permissions and preserves redacted tombstones', () => {
    const { service } = fixture();
    service.dispatch({ actorId: 'viewer', role: 'viewer' }, { type: 'create-comment', requestId: ids[0], threadId: ids[1], commentId: ids[2], objectId: 'note', body: 'secret', mentions: [], expectedRevision: 0 });
    expect(() => service.dispatch({ actorId: 'viewer', role: 'viewer' }, { type: 'resolve', requestId: ids[3], threadId: ids[1], resolved: true, expectedRevision: 1 })).toThrow('FORBIDDEN');
    const deleted = service.dispatch({ actorId: 'viewer', role: 'viewer' }, { type: 'delete-comment', requestId: ids[4], threadId: ids[1], commentId: ids[2], expectedRevision: 1 });
    expect(deleted.threads[0]?.comments[0]).toMatchObject({ body: '[deleted]', mentions: [], deletedAt: '2026-09-26T00:00:00.000Z' });
    const resolved = service.dispatch({ actorId: 'owner', role: 'owner' }, { type: 'resolve', requestId: ids[5], threadId: ids[1], resolved: true, expectedRevision: 2 });
    expect(resolved.events[0]).toMatchObject({ type: 'CommentResolved', resolved: true });
  });

  it('archives references when an object is deleted without leaking them in normal reads', () => {
    const { service, objects } = fixture();
    service.dispatch({ actorId: 'editor', role: 'editor' }, { type: 'create-comment', requestId: ids[0], threadId: ids[1], commentId: ids[2], objectId: 'note', body: 'bound', mentions: [], expectedRevision: 0 });
    objects.delete('note');
    const archived = service.dispatch({ actorId: 'editor', role: 'editor' }, { type: 'archive-object-comments', requestId: ids[3], objectId: 'note' });
    expect(archived.threads[0]).toMatchObject({ status: 'object-deleted', archivedAt: '2026-09-26T00:00:00.000Z' });
    expect(service.list({ actorId: 'viewer', role: 'viewer' })).toEqual([]);
    expect(service.list({ actorId: 'owner', role: 'owner' }, true)).toHaveLength(1);
  });

  it('fails closed for absent objects, foreign mentions and invalid actors', () => {
    const { service } = fixture();
    const base = { type: 'create-comment' as const, requestId: ids[0], threadId: ids[1], commentId: ids[2], objectId: 'missing', body: 'x', mentions: [], expectedRevision: 0 as const };
    expect(() => service.dispatch({ actorId: 'owner', role: 'owner' }, base)).toThrow('OBJECT_NOT_FOUND');
    expect(() => service.dispatch({ actorId: 'owner', role: 'owner' }, { ...base, objectId: 'note', mentions: [{ userId: 'outsider' }] })).toThrow('INVALID_MENTION');
  });
});

describe('transient presence and recovery manifests', () => {
  it('bounds, throttles and expires awareness without durable state', () => {
    const registry = new WhiteboardPresenceRegistry(1000, 50);
    const input = { actorId: 'u', displayName: 'Grace', contributorColor: '#3366ff', cursor: { x: 1, y: 2 }, selected: ['note'], editingObjectId: 'note' };
    expect(registry.update(input, 1000)).toMatchObject({ ...input, expiresAt: new Date(2000).toISOString() });
    expect(registry.update({ ...input, cursor: null }, 1020)).toBeNull();
    expect(registry.list(1999)).toHaveLength(1); expect(registry.list(2000)).toEqual([]);
    expect(() => registry.update({ ...input, contributorColor: 'red' }, 3000)).toThrow('PRESENCE_INVALID');
  });

  it('verifies immutable object-storage checkpoint bytes and restores into a new epoch', async () => {
    const bytes = new TextEncoder().encode('yjs-snapshot');
    const manifest = { checkpointId: ids[0], boardId, version: 1 as const, epoch: 3, seq: 9, objectKey: 'org/o/boards/b/checkpoints/c', contentHash: await checkpointHash(bytes), byteSize: bytes.byteLength, createdBy: 'owner', createdAt: '2026-09-26T00:00:00.000Z' };
    await expect(verifyCheckpoint(manifest, bytes)).resolves.toBeUndefined();
    await expect(verifyCheckpoint(manifest, new TextEncoder().encode('tampered'))).rejects.toThrow('CHECKPOINT_HASH_MISMATCH');
    expect(restoredHead({ epoch: 3, seq: 12 }, manifest)).toEqual({ epoch: 4, seq: 0, restoredFrom: { epoch: 3, seq: 9, checkpointId: ids[0] } });
    expect(() => restoredHead({ epoch: 2, seq: 20 }, manifest)).toThrow('CHECKPOINT_AHEAD');
  });
});

