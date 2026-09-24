import { z } from 'zod';
import { BoardId } from './whiteboard';
import { WhiteboardGeometry, WhiteboardObjectId, WhiteboardStyle, WHITEBOARD_LIMITS } from './whiteboard-document';

export const WHITEBOARD_HISTORY_LIMITS = {
  listedCheckpoints: 100,
  checkpointBytes: 32 * 1024 * 1024 + 1024,
  checkpointObjects: WHITEBOARD_LIMITS.objects,
  labelChars: 100,
  reasonChars: 500,
  boardNameChars: 200,
  retentionDays: 3650,
} as const;

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const CheckpointId = z.string().uuid();
export const CheckpointLabel = z.string().trim().min(1).max(WHITEBOARD_HISTORY_LIMITS.labelChars);
export const HistoryReason = z.string().trim().min(1).max(WHITEBOARD_HISTORY_LIMITS.reasonChars);
export const HistoryHead = z.object({
  epoch: z.number().int().positive(),
  seq: z.number().int().nonnegative().safe(),
  digest: Digest,
}).strict();
export type HistoryHead = z.infer<typeof HistoryHead>;

export const Checkpoint = z.object({
  id: CheckpointId,
  boardId: BoardId,
  epoch: z.number().int().positive(),
  seq: z.number().int().nonnegative().safe(),
  headDigest: Digest,
  contentDigest: Digest,
  byteLength: z.number().int().nonnegative().max(WHITEBOARD_HISTORY_LIMITS.checkpointBytes),
  objectCount: z.number().int().nonnegative().max(WHITEBOARD_HISTORY_LIMITS.checkpointObjects),
  blobVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  creatorId: z.string().min(1).max(200),
  label: CheckpointLabel,
  reason: HistoryReason,
  retentionUntil: z.string().datetime(),
  retentionState: z.enum(['active', 'expired', 'pinned']),
  sourceBoardId: BoardId.nullable(),
  sourceCheckpointId: CheckpointId.nullable(),
}).strict();
export type Checkpoint = z.infer<typeof Checkpoint>;

export const CreateCheckpoint = z.object({
  requestId: z.string().uuid(),
  label: CheckpointLabel,
  reason: HistoryReason,
  retentionDays: z.number().int().min(1).max(WHITEBOARD_HISTORY_LIMITS.retentionDays),
  expectedHead: HistoryHead,
}).strict();

export const HistoryObject = z.object({
  id: WhiteboardObjectId,
  kind: z.enum(['sticky', 'text', 'rectangle', 'ellipse', 'frame', 'group', 'connector', 'image', 'drawing', 'extension']),
  geometry: WhiteboardGeometry,
  text: z.string().max(500),
  style: WhiteboardStyle,
  parentId: WhiteboardObjectId.nullable(),
  parentMissing: z.boolean(),
  connector: z.object({ from: WhiteboardObjectId, to: WhiteboardObjectId, fromMissing: z.boolean(), toMissing: z.boolean() }).strict().nullable(),
}).strict();
export type HistoryObject = z.infer<typeof HistoryObject>;

export const CheckpointPreview = z.object({ checkpoint: Checkpoint, objects: z.array(HistoryObject).max(WHITEBOARD_HISTORY_LIMITS.checkpointObjects) }).strict();

export const CompareCheckpoint = z.object({
  fromCheckpointId: CheckpointId,
  to: z.union([z.literal('current'), CheckpointId]),
}).strict();
export const HistoryChange = z.object({
  id: WhiteboardObjectId,
  change: z.enum(['added', 'modified', 'deleted']),
  before: HistoryObject.nullable(),
  after: HistoryObject.nullable(),
}).strict();
export const CheckpointComparison = z.object({
  from: z.object({ checkpointId: CheckpointId, contentDigest: Digest }).strict(),
  to: z.union([
    z.object({ kind: z.literal('current'), head: HistoryHead }).strict(),
    z.object({ kind: z.literal('checkpoint'), checkpointId: CheckpointId, contentDigest: Digest }).strict(),
  ]),
  added: z.number().int().nonnegative(), modified: z.number().int().nonnegative(), deleted: z.number().int().nonnegative(),
  changes: z.array(HistoryChange).max(WHITEBOARD_HISTORY_LIMITS.checkpointObjects * 2),
}).strict();

export const RestoreCheckpoint = z.object({
  requestId: z.string().uuid(),
  sourceContentDigest: Digest,
  boardName: z.string().trim().min(1).max(WHITEBOARD_HISTORY_LIMITS.boardNameChars),
  reason: HistoryReason,
  retentionDays: z.number().int().min(1).max(WHITEBOARD_HISTORY_LIMITS.retentionDays),
}).strict();
export const RestoreReceipt = z.object({
  restoreId: z.string().uuid(), sourceBoardId: BoardId, sourceCheckpointId: CheckpointId,
  restoredBoardId: BoardId, restoredCheckpointId: CheckpointId,
  actorId: z.string().min(1).max(200), reason: HistoryReason, createdAt: z.string().datetime(), replayed: z.boolean(),
}).strict();
export type RestoreReceipt = z.infer<typeof RestoreReceipt>;

export const operations = {
  historyHead: { method: 'GET', path: '/whiteboards/:boardId/checkpoints/head', out: HistoryHead },
  listCheckpoints: { method: 'GET', path: '/whiteboards/:boardId/checkpoints', out: z.object({ items: z.array(Checkpoint).max(WHITEBOARD_HISTORY_LIMITS.listedCheckpoints) }).strict() },
  createCheckpoint: { method: 'POST', path: '/whiteboards/:boardId/checkpoints', in: CreateCheckpoint, out: Checkpoint },
  previewCheckpoint: { method: 'GET', path: '/whiteboards/:boardId/checkpoints/:checkpointId', out: CheckpointPreview },
  compareCheckpoints: { method: 'POST', path: '/whiteboards/:boardId/checkpoints/compare', in: CompareCheckpoint, out: CheckpointComparison },
  restoreCheckpoint: { method: 'POST', path: '/whiteboards/:boardId/checkpoints/:checkpointId/restores', in: RestoreCheckpoint, out: RestoreReceipt },
  copyCheckpoint: { method: 'POST', path: '/whiteboards/:boardId/checkpoints/:checkpointId/copies', in: RestoreCheckpoint, out: RestoreReceipt },
} as const;
