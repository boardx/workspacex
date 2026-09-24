import type * as C from '@repo/contracts/whiteboard-workshop';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_WORKSHOP = Symbol('WhiteboardWorkshop');
export type WorkshopConflictCode =
  | 'OBJECT_NOT_FOUND'
  | 'REQUEST_ID_REUSED'
  | 'COMMENT_LIMIT'
  | 'DRAFT_REVISION_CHANGED'
  | 'DRAFT_EMPTY'
  | 'VOTE_SESSION_LIMIT'
  | 'VOTE_CLOSED'
  | 'VOTE_TARGET_INVALID'
  | 'VOTE_QUOTA_EXCEEDED'
  | 'WORKSHOP_CONFLICT';
export class WorkshopConflict extends Error {
  constructor(readonly code: WorkshopConflictCode) {
    super(code);
    this.name = 'WorkshopConflict';
  }
}
export interface WhiteboardWorkshop {
  comments(p: Principal, boardId: string): Promise<C.Comment[] | null>;
  addComment(p: Principal, boardId: string, input: C.CreateComment): Promise<C.Comment | null>;
  deleteComment(p: Principal, boardId: string, commentId: string): Promise<boolean>;
  draft(p: Principal, boardId: string): Promise<C.PrivateDraft | null>;
  saveDraft(p: Principal, boardId: string, input: C.SavePrivateDraft): Promise<C.PrivateDraft | null>;
  publishDraft(p: Principal, boardId: string, input: C.PublishDraft): Promise<C.PublishedDraft | null>;
  votes(p: Principal, boardId: string): Promise<C.Vote[] | null>;
  createVote(p: Principal, boardId: string, input: C.CreateVote): Promise<C.Vote | null>;
  castVote(p: Principal, boardId: string, voteId: string, input: C.CastVote): Promise<C.Vote | null>;
  closeVote(p: Principal, boardId: string, voteId: string): Promise<C.Vote | null>;
  timer(p: Principal, boardId: string): Promise<C.Timer | null>;
  startTimer(p: Principal, boardId: string, input: C.StartTimer): Promise<C.Timer | null>;
  stopTimer(p: Principal, boardId: string): Promise<C.Timer | null>;
}
