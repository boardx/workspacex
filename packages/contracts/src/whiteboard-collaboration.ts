import { z } from 'zod';
import { BoardId, BoardRole } from './whiteboard';
import { WhiteboardObjectId } from './whiteboard-document';

export const WHITEBOARD_COLLABORATION_LIMITS = {
  commentChars: 4000, mentions: 50, commentsPerThread: 500, threadsPerObject: 500,
  displayNameChars: 120, selectionIds: 200, presenceTtlMs: 30_000,
  presenceMinimumIntervalMs: 50, checkpointBytes: 32 * 1024 * 1024,
} as const;

export const WhiteboardCommentId = z.string().uuid();
export const WhiteboardCommentThreadId = z.string().uuid();
const ActorId = z.string().min(1).max(200);
export const WhiteboardMention = z.object({ userId: z.string().min(1).max(200) }).strict();
export const WhiteboardComment = z.object({
  id: WhiteboardCommentId, threadId: WhiteboardCommentThreadId, boardId: BoardId,
  objectId: WhiteboardObjectId.nullable(), worldPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable().default(null), parentCommentId: WhiteboardCommentId.nullable(),
  authorId: ActorId, body: z.string().trim().min(1).max(WHITEBOARD_COLLABORATION_LIMITS.commentChars),
  mentions: z.array(WhiteboardMention).max(WHITEBOARD_COLLABORATION_LIMITS.mentions),
  createdAt: z.string().datetime(), deletedAt: z.string().datetime().nullable(),
}).strict();
export const WhiteboardCommentThread = z.object({
  id: WhiteboardCommentThreadId, boardId: BoardId, objectId: WhiteboardObjectId.nullable(), worldPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable().default(null),
  status: z.enum(['open', 'resolved', 'object-deleted']), revision: z.number().int().positive(),
  resolvedBy: ActorId.nullable(), resolvedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(), comments: z.array(WhiteboardComment).max(WHITEBOARD_COLLABORATION_LIMITS.commentsPerThread),
}).strict().superRefine((value,ctx)=>{if((value.objectId===null)===(value.worldPosition===null))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Exactly one comment anchor is required'});});
export type WhiteboardCommentThread = z.infer<typeof WhiteboardCommentThread>;

export const WhiteboardCommentCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create-comment'), requestId: z.string().uuid(), threadId: WhiteboardCommentThreadId, commentId: WhiteboardCommentId, objectId: WhiteboardObjectId.nullable(), worldPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable().default(null), body: WhiteboardComment.shape.body, mentions: WhiteboardComment.shape.mentions, expectedRevision: z.literal(0) }).strict(),
  z.object({ type: z.literal('reply'), requestId: z.string().uuid(), commentId: WhiteboardCommentId, threadId: WhiteboardCommentThreadId, body: WhiteboardComment.shape.body, mentions: WhiteboardComment.shape.mentions, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('resolve'), requestId: z.string().uuid(), threadId: WhiteboardCommentThreadId, resolved: z.boolean(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('delete-comment'), requestId: z.string().uuid(), threadId: WhiteboardCommentThreadId, commentId: WhiteboardCommentId, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('archive-object-comments'), requestId: z.string().uuid(), objectId: WhiteboardObjectId }).strict(),
]).superRefine((value,ctx)=>{if(value.type==='create-comment'&&(value.objectId===null)===(value.worldPosition===null))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Exactly one comment anchor is required'});});
export type WhiteboardCommentCommand = z.infer<typeof WhiteboardCommentCommand>;

export const WhiteboardCollaborationEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CommentCreated'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, threadId: WhiteboardCommentThreadId, commentId: WhiteboardCommentId, objectId: WhiteboardObjectId.nullable(), worldPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('CommentReplied'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, threadId: WhiteboardCommentThreadId, commentId: WhiteboardCommentId, objectId: WhiteboardObjectId.nullable(), worldPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('CommentResolved'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, threadId: WhiteboardCommentThreadId, resolved: z.boolean(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('CommentDeleted'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, threadId: WhiteboardCommentThreadId, commentId: WhiteboardCommentId, actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('ObjectCommentsArchived'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, objectId: WhiteboardObjectId, threadIds: z.array(WhiteboardCommentThreadId).max(WHITEBOARD_COLLABORATION_LIMITS.threadsPerObject), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('CheckpointCreated'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, checkpointId: z.string().uuid(), epoch: z.number().int().positive(), seq: z.number().int().nonnegative(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('BoardRestored'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, checkpointId: z.string().uuid(), previousEpoch: z.number().int().positive(), epoch: z.number().int().positive(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('CheckpointFallbackUsed'), eventId: z.string().uuid(), operationId: z.string().uuid(), boardId: BoardId, requestedCheckpointId: z.string().uuid(), fallbackCheckpointId: z.string().uuid(), replayedThroughSeq: z.number().int().nonnegative(), actorId: ActorId, occurredAt: z.string().datetime() }).strict(),
]);
export type WhiteboardCollaborationEvent = z.infer<typeof WhiteboardCollaborationEvent>;

export const WhiteboardCheckpointManifest = z.object({
  checkpointId: z.string().uuid(), boardId: BoardId, version: z.literal(1), epoch: z.number().int().positive(),
  seq: z.number().int().nonnegative(), objectKey: z.string().min(1).max(1024).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\x20-\x7e]+$/),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), byteSize: z.number().int().positive().max(WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes),
  createdBy: ActorId, createdAt: z.string().datetime(),
}).strict();
export type WhiteboardCheckpointManifest = z.infer<typeof WhiteboardCheckpointManifest>;

export const WhiteboardResumeDisposition = z.enum(['resumed', 'reload-required', 'access-revoked', 'board-archived', 'retry-later']);
export const WhiteboardRecoveryCode = z.enum(['RESUME_OK', 'STALE_EPOCH', 'HISTORY_UNAVAILABLE', 'ACCESS_REVOKED', 'BOARD_ARCHIVED', 'DEPENDENCY_UNAVAILABLE', 'PROTOCOL_LIMIT']);
export const WhiteboardOperationActor = z.object({ actorId: ActorId, role: BoardRole }).strict();
export const whiteboardCollaborationOperations = {
  listComments: { method: 'GET', path: '/whiteboards/:boardId/comments', in: z.object({ boardId: BoardId }).strict(), out: z.object({ items: z.array(WhiteboardCommentThread) }).strict() },
  dispatchComment: { method: 'POST', path: '/whiteboards/:boardId/comments/commands', in: WhiteboardCommentCommand, out: z.object({ operationId: z.string().uuid(), replayed: z.boolean(), threads: z.array(WhiteboardCommentThread), events: z.array(WhiteboardCollaborationEvent) }).strict() },
  createCheckpoint: { method: 'POST', path: '/whiteboards/:boardId/checkpoints', in: z.object({ requestId: z.string().uuid() }).strict(), out: z.object({ manifest: WhiteboardCheckpointManifest, event: WhiteboardCollaborationEvent, replayed: z.boolean() }).strict() },
  restoreCheckpoint: { method: 'POST', path: '/whiteboards/:boardId/checkpoints/:checkpointId/restore', in: z.object({ requestId: z.string().uuid(), expectedEpoch: z.number().int().positive(), expectedSeq: z.number().int().nonnegative() }).strict(), out: z.object({ epoch: z.number().int().positive(), seq: z.literal(0), replayed: z.boolean(), event: WhiteboardCollaborationEvent }).strict() },
  dispatchCommands: { method: 'POST', path: '/whiteboards/:boardId/commands', in: z.object({ requestId:z.string().uuid(),epoch:z.number().int().positive(),commands:z.array(z.unknown()).min(1).max(200) }).strict(), out:z.object({epoch:z.number().int().positive(),seq:z.number().int().nonnegative(),updateId:z.string().uuid(),replayed:z.boolean()}).strict() },
} as const;
