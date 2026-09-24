import { z } from 'zod';
import { BoardId } from './whiteboard';
import { WhiteboardObjectId } from './whiteboard-document';

export const WHITEBOARD_DISCUSSION_LIMITS = { pageSize: 50, commentsPerThread: 500, body: 4000, mentions: 20 } as const;
const RequestId = z.string().uuid();
export const CommentId = z.string().uuid();
export const ThreadId = z.string().uuid();
export const TaskId = z.string().uuid();
export const MentionUserIds = z.array(z.string().min(1).max(200)).max(WHITEBOARD_DISCUSSION_LIMITS.mentions).default([]);
export const Anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('object'), objectId: WhiteboardObjectId, label: z.string().trim().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('point'), x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000) }).strict(),
]);
export const BoardTask = z.object({ id: TaskId, sourceCommentId: CommentId, assigneeId: z.string().min(1).nullable(), dueAt: z.string().datetime().nullable(), status: z.enum(['open','done']), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export const Comment = z.object({ id: CommentId, authorId: z.string().min(1), body: z.string().max(WHITEBOARD_DISCUSSION_LIMITS.body), mentionUserIds: MentionUserIds, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), editedAt: z.string().datetime().nullable(), deletedAt: z.string().datetime().nullable() }).strict();
export const Thread = z.object({ id: ThreadId, boardId: BoardId, anchor: Anchor, resolvedAt: z.string().datetime().nullable(), comments: z.array(Comment).max(WHITEBOARD_DISCUSSION_LIMITS.commentsPerThread), task: BoardTask.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export type Thread = z.infer<typeof Thread>;
export const CreateThread = z.object({ requestId: RequestId, anchor: Anchor, body: z.string().trim().min(1).max(WHITEBOARD_DISCUSSION_LIMITS.body), mentionUserIds: MentionUserIds }).strict();
export const Reply = z.object({ requestId: RequestId, body: z.string().trim().min(1).max(WHITEBOARD_DISCUSSION_LIMITS.body), mentionUserIds: MentionUserIds }).strict();
export const EditComment = z.object({ body: z.string().trim().min(1).max(WHITEBOARD_DISCUSSION_LIMITS.body), mentionUserIds: MentionUserIds }).strict();
export const ResolveThread = z.object({ resolved: z.boolean() }).strict();
export const UpsertTask = z.object({ requestId: RequestId, assigneeId: z.string().min(1).max(200).nullable().default(null), dueAt: z.string().datetime().nullable().default(null) }).strict();
export const UpdateTask = z.object({ assigneeId: z.string().min(1).max(200).nullable().optional(), dueAt: z.string().datetime().nullable().optional(), status: z.enum(['open','done']).optional() }).strict().refine(v => Object.keys(v).length > 0);
export const ListThreads = z.object({ cursor: z.string().uuid().optional() }).strict();
export const ThreadPage = z.object({ items: z.array(Thread).max(WHITEBOARD_DISCUSSION_LIMITS.pageSize), nextCursor: z.string().uuid().nullable() }).strict();
export type ThreadPage = z.infer<typeof ThreadPage>;

export const operations = {
  listThreads: { method: 'GET', path: '/whiteboards/:boardId/threads', in: ListThreads, out: ThreadPage },
  createThread: { method: 'POST', path: '/whiteboards/:boardId/threads', in: CreateThread, out: Thread },
  reply: { method: 'POST', path: '/whiteboards/:boardId/threads/:threadId/comments', in: Reply, out: Thread },
  editComment: { method: 'PATCH', path: '/whiteboards/:boardId/comments/:commentId', in: EditComment, out: Thread },
  deleteComment: { method: 'DELETE', path: '/whiteboards/:boardId/comments/:commentId', out: Thread },
  resolveThread: { method: 'PATCH', path: '/whiteboards/:boardId/threads/:threadId', in: ResolveThread, out: Thread },
  createTask: { method: 'POST', path: '/whiteboards/:boardId/threads/:threadId/task', in: UpsertTask, out: Thread },
  updateTask: { method: 'PATCH', path: '/whiteboards/:boardId/tasks/:taskId', in: UpdateTask, out: Thread },
} as const;
