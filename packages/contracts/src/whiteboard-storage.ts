import { z } from 'zod';
import { WhiteboardAssetMetadata } from './whiteboard-asset';
import { WhiteboardComment, WhiteboardCommentThread, WHITEBOARD_COLLABORATION_LIMITS } from './whiteboard-collaboration';

const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(256);

export const CommentThreadMetadataSchema = WhiteboardCommentThread.innerType().extend({
  comments: z.array(WhiteboardComment.omit({ body: true })).max(WHITEBOARD_COLLABORATION_LIMITS.commentsPerThread),
});
export type CommentThreadMetadata = z.infer<typeof CommentThreadMetadataSchema>;

export const CommentBackupDescriptorSchema = z.object({
  id: Id,
  objectId: z.string().nullable(),
  status: WhiteboardCommentThread.innerType().shape.status,
  revision: z.number().int().positive(),
  metadata: CommentThreadMetadataSchema,
  blob: z.object({
    key: z.string().min(1),
    hash: Hash,
    bytes: z.number().int().positive().max(WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes),
    mime: z.literal('application/json'),
  }).strict(),
}).strict();
export type CommentBackupDescriptor = z.infer<typeof CommentBackupDescriptorSchema>;

export const BackupBlob = z.object({
  key: z.string().min(1).max(1024),
  hash: Hash,
  bytes: z.number().int().positive().max(33_554_432),
  mime: z.string().min(1).max(128),
}).strict();
export type BackupBlob = z.infer<typeof BackupBlob>;

export const BoardBackupManifest = z.object({
  version: z.literal(1),
  backupId: Id,
  orgId: z.string().min(1),
  capturedAt: z.string().datetime(),
  board: z.object({
    id: Id,
    name: z.string().trim().min(1).max(200),
    ownerId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archived: z.boolean(),
    lifecycleRevision: z.number().int().nonnegative(),
    tagsRevision: z.number().int().nonnegative(),
    members: z.array(z.object({ userId: z.string().min(1), role: z.enum(['editor', 'commenter', 'viewer']) }).strict()).max(10_000),
    tags: z.array(z.object({ id: Id, name: z.string(), revision: z.number().int().positive() }).strict()).max(1_000),
  }).strict(),
  revision: z.object({ epoch: z.number().int().positive(), seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  snapshot: BackupBlob,
  images: z.array(z.object({ blob: BackupBlob, metadata: WhiteboardAssetMetadata }).strict()).max(5_000),
  comments: z.array(CommentBackupDescriptorSchema).max(10_000),
  // Optional, not defaulted: preserve the exact hash of already-issued v1 manifests.
  sourceHistory: z.array(BackupBlob).max(20_000).optional(),
}).strict();
export type BoardBackupManifest = z.infer<typeof BoardBackupManifest>;

export const BackfillScopeSchema = z.array(z.union([
  z.object({ orgId: identity, actorId: identity, allBoards: z.literal(true) }).strict(),
  z.object({ orgId: identity, actorId: identity, boardIds: z.array(Id).min(1).max(10_000) }).strict(),
])).min(1).max(10_000).refine(rows => new Set(rows.map(row => row.orgId)).size === rows.length);
export type BackfillScope = z.infer<typeof BackfillScopeSchema>;

export const BackfillCursorSchema = z.object({
  version: z.literal(1),
  scopeHash: Hash,
  execute: z.boolean(),
  failures: z.number().int().nonnegative(),
  tenant: z.number().int().nonnegative(),
  after: Id.nullable(),
}).strict();

export const BackfillConfigSchema = z.object({
  execute: z.boolean(),
  boardLimit: z.number().int().min(1).max(1_000),
  rowLimit: z.number().int().min(1).max(1_000),
  delayMs: z.number().int().min(0).max(60_000),
}).strict();
