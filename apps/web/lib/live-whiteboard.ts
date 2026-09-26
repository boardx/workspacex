import { whiteboard as C } from '@repo/contracts';
import type { z } from 'zod';
import { apiRequest } from './api-client';

export type Board = C.Board;
export type BoardTag = C.BoardTag;
export type BoardMember = z.infer<typeof C.Member>;
export type CreateBoardInput = z.infer<typeof C.CreateBoard>;
export type UpdateBoardInput = z.infer<typeof C.UpdateBoard>;
export type ListBoardsInput = z.input<typeof C.ListBoards>;
export type DuplicateBoardInput = z.infer<typeof C.DuplicateBoard>;
export type CreateBoardTagInput = z.infer<typeof C.CreateBoardTag>;
export type RenameBoardTagInput = z.infer<typeof C.RenameBoardTag>;
export type DeleteBoardTagInput = z.infer<typeof C.DeleteBoardTag>;

const ops = C.operations;
const replacePath = (path: string, values: Record<string, string>) => Object.entries(values).reduce(
  (result, [key, value]) => result.replace(`:${key}`, encodeURIComponent(value)), path,
);
const boardPath = (path: string, id: string) => replacePath(path, { boardId: id });

export async function listBoards(input: ListBoardsInput = {}) {
  const query = C.ListBoards.parse(input);
  const params = new URLSearchParams({ archived: query.archived, limit: String(query.limit) });
  if (query.query) params.set('query', query.query);
  if (query.cursor) params.set('cursor', query.cursor);
  query.tagIds?.forEach(id => params.append('tagIds', id));
  return ops.listBoards.out.parse(await apiRequest(`${ops.listBoards.path}?${params}`, { method: ops.listBoards.method }));
}
export async function listBoardTags() { return ops.listBoardTags.out.parse(await apiRequest(ops.listBoardTags.path, { method: ops.listBoardTags.method })).items; }
export async function createBoardTag(input: CreateBoardTagInput) { return C.BoardTag.parse(await apiRequest(ops.createBoardTag.path, { method: ops.createBoardTag.method, body: C.CreateBoardTag.parse(input) })); }
export async function renameBoardTag(tagId: string, input: RenameBoardTagInput) { return C.BoardTag.parse(await apiRequest(replacePath(ops.renameBoardTag.path, { tagId }), { method: ops.renameBoardTag.method, body: C.RenameBoardTag.parse(input) })); }
export async function deleteBoardTag(tagId: string, input: DeleteBoardTagInput) { return ops.deleteBoardTag.out.parse(await apiRequest(replacePath(ops.deleteBoardTag.path, { tagId }), { method: ops.deleteBoardTag.method, body: C.DeleteBoardTag.parse(input) })); }
export async function createBoard(input: CreateBoardInput) { return C.Board.parse(await apiRequest(ops.createBoard.path, { method: ops.createBoard.method, body: C.CreateBoard.parse(input) })); }
export async function getBoard(id: string) { return C.Board.parse(await apiRequest(boardPath(ops.getBoard.path, id), { method: ops.getBoard.method })); }
export async function updateBoard(id: string, input: UpdateBoardInput) { return C.Board.parse(await apiRequest(boardPath(ops.updateBoard.path, id), { method: ops.updateBoard.method, body: C.UpdateBoard.parse(input) })); }
export async function duplicateBoard(id: string, input: DuplicateBoardInput) { return ops.duplicateBoard.out.parse(await apiRequest(boardPath(ops.duplicateBoard.path, id), { method: ops.duplicateBoard.method, body: C.DuplicateBoard.parse(input) })); }
export async function deleteBoard(id: string, input: z.infer<typeof C.DeleteBoard>) { return ops.deleteBoard.out.parse(await apiRequest(boardPath(ops.deleteBoard.path, id), { method: ops.deleteBoard.method, body: C.DeleteBoard.parse(input) })); }
export async function listBoardMembers(id: string) { return ops.listMembers.out.parse(await apiRequest(boardPath(ops.listMembers.path, id), { method: ops.listMembers.method })).items; }
export async function putBoardMember(id: string, member: BoardMember) { return ops.putMember.out.parse(await apiRequest(boardPath(ops.putMember.path, id), { method: ops.putMember.method, body: C.Member.parse(member) })); }
export async function removeBoardMember(id: string, userId: string) { return ops.removeMember.out.parse(await apiRequest(replacePath(ops.removeMember.path, { boardId: id, userId }), { method: ops.removeMember.method })); }
