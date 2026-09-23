import type { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_REPOSITORY = Symbol('WhiteboardRepository');
export type CreateBoard = ReturnType<typeof C.CreateBoard.parse>;
export type UpdateBoard = ReturnType<typeof C.UpdateBoard.parse>;
export type Member = ReturnType<typeof C.Member.parse>;
export interface WhiteboardRepository {
  list(principal: Principal): Promise<C.Board[]>;
  create(principal: Principal, input: CreateBoard): Promise<C.Board>;
  get(principal: Principal, boardId: string): Promise<C.Board | null>;
  update(principal: Principal, boardId: string, input: UpdateBoard): Promise<C.Board | null>;
  members(principal: Principal, boardId: string): Promise<Member[] | null>;
  putMember(principal: Principal, boardId: string, member: Member): Promise<boolean>;
  removeMember(principal: Principal, boardId: string, userId: string): Promise<boolean>;
}
