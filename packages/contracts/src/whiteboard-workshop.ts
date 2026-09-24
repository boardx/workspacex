import { z } from 'zod';
import { WhiteboardObjectId, WhiteboardGeometry } from './whiteboard-document';
export const CreateComment = z.object({ requestId: z.string().uuid(), objectId: WhiteboardObjectId.nullable(), text: z.string().trim().min(1).max(4000) }).strict();
export type CreateComment = z.infer<typeof CreateComment>;
export const Comment = z.object({ id: z.string().uuid(), authorId: z.string(), objectId: WhiteboardObjectId.nullable(), text: z.string(), createdAt: z.string().datetime() }).strict();
export type Comment = z.infer<typeof Comment>;
export const SavePrivateDraft = z.object({ text: z.string().max(20000) }).strict();
export type SavePrivateDraft = z.infer<typeof SavePrivateDraft>;
export const PrivateDraft = SavePrivateDraft.extend({ revision: z.string().uuid().nullable() }).strict();
export const PublishDraft = z.object({ requestId: z.string().uuid(), expectedRevision: z.string().uuid(), geometry: WhiteboardGeometry }).strict();
export type PublishDraft = z.infer<typeof PublishDraft>;
export const PublishedDraft = z.object({ objectId: WhiteboardObjectId, epoch: z.number().int().positive(), committedSeq: z.number().int().positive(), replayed: z.boolean() }).strict();
export type PublishedDraft = z.infer<typeof PublishedDraft>;
export type PrivateDraft = z.infer<typeof PrivateDraft>;
export const CreateVote = z.object({ requestId: z.string().uuid(), title: z.string().trim().min(1).max(200),
  quota: z.number().int().min(1).max(100), durationSeconds: z.number().int().min(1).max(86400),
  objectIds: z.array(WhiteboardObjectId).min(1).max(5000).refine(ids => new Set(ids).size === ids.length, 'Unique targets required'),
}).strict();
export type CreateVote = z.infer<typeof CreateVote>;
export const CastVote = z.object({ requestId: z.string().uuid(), objectId: WhiteboardObjectId, count: z.number().int().min(1).max(100) }).strict();
export type CastVote = z.infer<typeof CastVote>;
const VoteFields = { id: z.string().uuid(), title: z.string(), quota: z.number().int(), deadline: z.string().datetime(),
  objectIds: z.array(WhiteboardObjectId), used: z.number().int().nonnegative() };
const VoteResults = z.array(z.object({ objectId: WhiteboardObjectId, count: z.number().int().nonnegative() }).strict());
/** Anonymous by contract: active totals are hidden and voter identities/individual ballots are never returned. */
export const Vote = z.discriminatedUnion('closed', [
  z.object({ ...VoteFields, closed: z.literal(false), results: z.null() }).strict(),
  z.object({ ...VoteFields, closed: z.literal(true), results: VoteResults }).strict(),
]);
export type Vote = z.infer<typeof Vote>;
export const StartTimer = z.object({ durationSeconds: z.number().int().min(1).max(86400) }).strict();
export type StartTimer = z.infer<typeof StartTimer>;
export const Timer = z.object({ deadline: z.string().datetime().nullable(), running: z.boolean() }).strict();
export type Timer = z.infer<typeof Timer>;
export const WorkshopOk = z.object({ ok: z.literal(true) }).strict();
export const CommentList = z.object({ items: z.array(Comment) }).strict();
export const VoteList = z.object({ items: z.array(Vote) }).strict();
const base = '/whiteboards/:boardId/workshop';
export const operations = {
  comments: { method: 'GET', path: `${base}/comments`, out: CommentList },
  addComment: { method: 'POST', path: `${base}/comments`, in: CreateComment, out: Comment },
  deleteComment: { method: 'DELETE', path: `${base}/comments/:commentId`, out: WorkshopOk },
  draft: { method: 'GET', path: `${base}/draft`, out: PrivateDraft },
  saveDraft: { method: 'PUT', path: `${base}/draft`, in: SavePrivateDraft, out: PrivateDraft },
  publishDraft: { method: 'POST', path: `${base}/draft/publish`, in: PublishDraft, out: PublishedDraft },
  votes: { method: 'GET', path: `${base}/votes`, out: VoteList },
  createVote: { method: 'POST', path: `${base}/votes`, in: CreateVote, out: Vote },
  castVote: { method: 'POST', path: `${base}/votes/:voteId/ballots`, in: CastVote, out: Vote },
  closeVote: { method: 'POST', path: `${base}/votes/:voteId/close`, out: Vote },
  timer: { method: 'GET', path: `${base}/timer`, out: Timer },
  startTimer: { method: 'PUT', path: `${base}/timer`, in: StartTimer, out: Timer },
  stopTimer: { method: 'DELETE', path: `${base}/timer`, out: Timer },
} as const;
