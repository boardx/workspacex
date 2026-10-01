import { describe, expect, it } from 'vitest';
import { Board, BoardTag, BoardTagIds, DeleteBoard, DuplicateBoard, ListBoards, UpdateBoard, operations } from '../src/whiteboard';

const id = '9fe596a7-34bb-4fc5-8782-42fa6c4f3c98';
const tagId = '6426c0d9-d05a-42bf-9acd-f72c5aa71f6d';

describe('whiteboard library contract', () => {
  it('uses stable tag identities and canonical set order', () => {
    expect(BoardTag.parse({ id: tagId, name: ' Research ', revision: 1, createdBy: 'owner',
      createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' }).name).toBe('Research');
    expect(BoardTagIds.parse([tagId, id, tagId])).toEqual([id, tagId].sort());
    expect(BoardTagIds.parse(Array.from({ length: 21 }, () => tagId))).toEqual([tagId]);
  });
  it('keeps AND-tag filtering explicit and canonical', () => {
    expect(ListBoards.parse({ query: ' research ', tagIds: [tagId, tagId], archived: 'active' }))
      .toEqual({ query: 'research', tagIds: [tagId], archived: 'active', limit: 30 });
    expect(ListBoards.parse({ query: '   ' })).toEqual({ archived: 'active', limit: 30 });
  });
  it('requires tag set CAS pairs, duplicate idempotency and destructive confirmation', () => {
    expect(UpdateBoard.safeParse({ tagIds: [tagId] }).success).toBe(false);
    expect(UpdateBoard.parse({ tagIds: [tagId], expectedTagsRevision: 3 })).toMatchObject({ expectedTagsRevision: 3 });
    expect(DuplicateBoard.parse({ requestId: id, targetName: ' Copy ', expectedSource: { epoch: 1, seq: 4 } }))
      .toEqual({ requestId: id, targetName: 'Copy', expectedSource: { epoch: 1, seq: 4 } });
    expect(UpdateBoard.safeParse({ archived: true }).success).toBe(false);
    expect(UpdateBoard.safeParse({ name: 'Rename', expectedLifecycleRevision: 0 }).success).toBe(false);
    expect(UpdateBoard.parse({ archived: true, expectedLifecycleRevision: 0 })).toMatchObject({ archived: true, expectedLifecycleRevision: 0 });
    expect(DeleteBoard.safeParse({ requestId: id, confirmation: true, expectedLifecycleRevision: 1 }).success).toBe(false);
    expect(DeleteBoard.safeParse({ requestId: id, confirmation: 'PERMANENTLY_DELETE' }).success).toBe(false);
    expect(DeleteBoard.parse({ requestId: id, confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: 1 }))
      .toMatchObject({ confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: 1 });
  });
  it('returns tag IDs and a CAS revision on every board and publishes lifecycle operations', () => {
    expect(Board.parse({ id, name: 'Board', ownerId: 'owner', role: 'owner', archived: false,
      lifecycleRevision: 3, tagIds: [tagId], tagsRevision: 2, createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' }))
      .toMatchObject({ lifecycleRevision: 3, tagIds: [tagId], tagsRevision: 2 });
    expect(operations.duplicateBoard.path).toBe('/whiteboards/:boardId/duplicates');
    expect(operations.deleteBoard.path).toBe('/whiteboards/:boardId');
    expect(operations.listBoardTags.path).toBe('/whiteboard-tags');
  });
});
