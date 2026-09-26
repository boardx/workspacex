/** Whiteboard resource contract. Content updates use a separate collaboration protocol. */
import { z } from 'zod';
export const BoardId = z.string().uuid();
export const BoardRole = z.enum(['owner', 'editor', 'viewer']);
export const BoardTagId = z.string().uuid();
export const BoardTagName = z.string().trim().min(1).max(40);
export const BoardTagIds = z.array(BoardTagId)
  .transform(ids => [...new Set(ids)].sort())
  .refine(ids => ids.length <= 20, 'At most 20 distinct tags are allowed');
export const BoardTag = z.object({
  id: BoardTagId, name: BoardTagName, revision: z.number().int().positive(), createdBy: z.string().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type BoardTag = z.infer<typeof BoardTag>;
export const Board = z.object({
  id: BoardId, name: z.string().trim().min(1).max(200),
  ownerId: z.string().min(1), role: BoardRole, archived: z.boolean(),
  tagIds: BoardTagIds, tagsRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Board = z.infer<typeof Board>;
export const CreateBoard = z.object({ requestId: z.string().uuid(), name: Board.shape.name }).strict();
export const ListBoards = z.object({
  query: z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().max(200).optional(),
  ),
  tagIds: BoardTagIds.optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
export const UpdateBoard = z.object({
  name: Board.shape.name.optional(),
  archived: z.boolean().optional(),
  tagIds: BoardTagIds.optional(),
  expectedTagsRevision: z.number().int().nonnegative().optional(),
}).strict()
  .refine(v => v.name !== undefined || v.archived !== undefined || v.tagIds !== undefined, 'At least one change is required')
  .refine(v => (v.tagIds === undefined) === (v.expectedTagsRevision === undefined), 'tagIds and expectedTagsRevision must be provided together');
export const SourceVersion = z.object({ epoch: z.number().int().positive(), seq: z.number().int().nonnegative() }).strict();
export const DuplicateBoard = z.object({ requestId: z.string().uuid(), targetName: Board.shape.name, expectedSource: SourceVersion.optional() }).strict();
export const DuplicateBoardReceipt = z.object({
  requestId: z.string().uuid(), sourceBoardId: BoardId, sourceEpoch: z.number().int().positive(), sourceSeq: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(), connectorCount: z.number().int().nonnegative(), assetCount: z.number().int().nonnegative(),
}).strict();
export const DuplicateBoardResult = z.object({ board: Board, receipt: DuplicateBoardReceipt }).strict();
export type DuplicateBoardResult = z.infer<typeof DuplicateBoardResult>;
export const DeleteBoard = z.object({ requestId: z.string().uuid(), confirmation: z.literal('PERMANENTLY_DELETE') }).strict();
export const DeleteBoardReceipt = z.object({ requestId: z.string().uuid(), boardId: BoardId, deleted: z.literal(true) }).strict();
export type DeleteBoardReceipt = z.infer<typeof DeleteBoardReceipt>;
export const CreateBoardTag = z.object({ requestId: z.string().uuid(), name: BoardTagName }).strict();
export const RenameBoardTag = z.object({ requestId: z.string().uuid(), name: BoardTagName, expectedRevision: z.number().int().positive() }).strict();
export const DeleteBoardTag = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const WhiteboardErrorCode = z.enum([
  'NOT_FOUND', 'TAG_NOT_FOUND', 'TAG_NAME_CONFLICT', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT',
  'SOURCE_VERSION_CHANGED', 'BOARD_NOT_ARCHIVED', 'CURSOR_INVALID', 'CURSOR_FILTER_MISMATCH', 'COPY_INTEGRITY_FAILED',
]);
export const Member = z.object({ userId: z.string().min(1).max(200), role: z.enum(['editor', 'viewer']) }).strict();
export const operations = {
  listBoards: { method: 'GET', path: '/whiteboards', in: ListBoards, out: z.object({ items: z.array(Board), nextCursor: z.string().nullable() }).strict() },
  listBoardTags: { method: 'GET', path: '/whiteboard-tags', in: z.object({}).strict(), out: z.object({ items: z.array(BoardTag) }).strict() },
  createBoardTag: { method: 'POST', path: '/whiteboard-tags', in: CreateBoardTag, out: BoardTag },
  renameBoardTag: { method: 'PATCH', path: '/whiteboard-tags/:tagId', in: RenameBoardTag, out: BoardTag },
  deleteBoardTag: { method: 'DELETE', path: '/whiteboard-tags/:tagId', in: DeleteBoardTag, out: z.object({ requestId: z.string().uuid(), tagId: BoardTagId, deleted: z.literal(true) }).strict() },
  createBoard: { method: 'POST', path: '/whiteboards', in: CreateBoard, out: Board },
  getBoard: { method: 'GET', path: '/whiteboards/:boardId', in: z.object({ boardId: BoardId }).strict(), out: Board },
  updateBoard: { method: 'PATCH', path: '/whiteboards/:boardId', in: UpdateBoard, out: Board },
  duplicateBoard: { method: 'POST', path: '/whiteboards/:boardId/duplicates', in: DuplicateBoard, out: DuplicateBoardResult },
  deleteBoard: { method: 'DELETE', path: '/whiteboards/:boardId', in: DeleteBoard, out: DeleteBoardReceipt },
  listMembers: { method: 'GET', path: '/whiteboards/:boardId/members', in: z.object({ boardId: BoardId }).strict(), out: z.object({ items: z.array(Member) }).strict() },
  putMember: { method: 'PUT', path: '/whiteboards/:boardId/members', in: Member, out: z.object({ ok: z.literal(true) }).strict() },
  removeMember: { method: 'DELETE', path: '/whiteboards/:boardId/members/:userId', in: z.object({ userId: z.string().min(1) }).strict(), out: z.object({ ok: z.literal(true) }).strict() },
} as const;
