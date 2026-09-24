import type { z } from 'zod';
import type { whiteboardDiscussion as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_DISCUSSION = Symbol('WhiteboardDiscussion');
export type CreateThread = z.infer<typeof C.CreateThread>; export type Reply = z.infer<typeof C.Reply>; export type EditComment = z.infer<typeof C.EditComment>; export type ResolveThread = z.infer<typeof C.ResolveThread>; export type UpsertTask = z.infer<typeof C.UpsertTask>; export type UpdateTask = z.infer<typeof C.UpdateTask>;
export interface WhiteboardDiscussion {
  list(p: Principal, boardId: string, cursor?: string): Promise<C.ThreadPage | null>;
  create(p: Principal, boardId: string, input: CreateThread): Promise<C.Thread | null>;
  reply(p: Principal, boardId: string, threadId: string, input: Reply): Promise<C.Thread | null>;
  edit(p: Principal, boardId: string, commentId: string, input: EditComment): Promise<C.Thread | null>;
  delete(p: Principal, boardId: string, commentId: string): Promise<C.Thread | null>;
  resolve(p: Principal, boardId: string, threadId: string, input: ResolveThread): Promise<C.Thread | null>;
  createTask(p: Principal, boardId: string, threadId: string, input: UpsertTask): Promise<C.Thread | null>;
  updateTask(p: Principal, boardId: string, taskId: string, input: UpdateTask): Promise<C.Thread | null>;
}
