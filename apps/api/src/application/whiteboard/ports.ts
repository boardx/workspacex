import type { z } from 'zod';
import type { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_REPOSITORY = Symbol('WhiteboardRepository');
export const WHITEBOARD_TAG_REPOSITORY = Symbol('WhiteboardTagRepository');
export const DUPLICATE_BOARD_SERVICE = Symbol('DuplicateBoardService');
export type CreateBoard = z.infer<typeof C.CreateBoard>;
export type UpdateBoard = z.infer<typeof C.UpdateBoard>;
export type ListBoards = z.infer<typeof C.ListBoards>;
export type DeleteBoard = z.infer<typeof C.DeleteBoard>;
export type DuplicateBoard = z.infer<typeof C.DuplicateBoard>;
export type CreateBoardTag = z.infer<typeof C.CreateBoardTag>;
export type RenameBoardTag = z.infer<typeof C.RenameBoardTag>;
export type DeleteBoardTag = z.infer<typeof C.DeleteBoardTag>;
export type Member = z.infer<typeof C.Member>;
export type WhiteboardResourceErrorCode = z.infer<typeof C.WhiteboardErrorCode>;
export class WhiteboardResourceError extends Error {
  constructor(readonly code: WhiteboardResourceErrorCode) { super(code); }
}
export type BoardListPage = z.infer<typeof C.operations.listBoards.out>;
export interface WhiteboardRepository {
  list(principal: Principal, input?: ListBoards): Promise<BoardListPage>;
  create(principal: Principal, input: CreateBoard): Promise<C.Board>;
  get(principal: Principal, boardId: string): Promise<C.Board | null>;
  update(principal: Principal, boardId: string, input: UpdateBoard): Promise<C.Board | null>;
  permanentlyDelete(principal: Principal, boardId: string, input: DeleteBoard): Promise<z.infer<typeof C.DeleteBoardReceipt> | null>;
  members(principal: Principal, boardId: string): Promise<Member[] | null>;
  putMember(principal: Principal, boardId: string, member: Member): Promise<boolean>;
  removeMember(principal: Principal, boardId: string, userId: string): Promise<boolean>;
}
export interface WhiteboardTagRepository {
  listTags(principal: Principal): Promise<C.BoardTag[]>;
  createTag(principal: Principal, input: CreateBoardTag): Promise<C.BoardTag>;
  renameTag(principal: Principal, tagId: string, input: RenameBoardTag): Promise<C.BoardTag | null>;
  deleteTag(principal: Principal, tagId: string, input: DeleteBoardTag): Promise<{ requestId: string; tagId: string; deleted: true } | null>;
}
export interface DuplicateBoardService {
  duplicate(principal: Principal, sourceBoardId: string, input: DuplicateBoard): Promise<C.DuplicateBoardResult>;
}
