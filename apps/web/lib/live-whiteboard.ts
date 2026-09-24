import { whiteboard as C } from '@repo/contracts';
import { whiteboardTransfer as T } from '@repo/contracts';
import type { z } from 'zod';
import { apiRequest } from './api-client';
export type Board = C.Board;
export type BoardMember = z.infer<typeof C.Member>;
export type CreateBoardInput = z.infer<typeof C.CreateBoard>;
export type UpdateBoardInput = z.infer<typeof C.UpdateBoard>;
const ops = C.operations;
const boardPath = (path: string, id: string) => path.replace(':boardId', encodeURIComponent(id));
export async function listBoards() { return ops.listBoards.out.parse(await apiRequest(ops.listBoards.path, { method: ops.listBoards.method })).items; }
export async function createBoard(input: CreateBoardInput) { return C.Board.parse(await apiRequest(ops.createBoard.path, { method: ops.createBoard.method, body: C.CreateBoard.parse(input) })); }
export async function getBoard(id: string) { return C.Board.parse(await apiRequest(boardPath(ops.getBoard.path, id), { method: ops.getBoard.method })); }
export async function updateBoard(id: string, input: UpdateBoardInput) { return C.Board.parse(await apiRequest(boardPath(ops.updateBoard.path, id), { method: ops.updateBoard.method, body: C.UpdateBoard.parse(input) })); }
export async function listBoardMembers(id: string) { return ops.listMembers.out.parse(await apiRequest(boardPath(ops.listMembers.path, id), { method: ops.listMembers.method })).items; }
export async function putBoardMember(id: string, member: BoardMember) { return ops.putMember.out.parse(await apiRequest(boardPath(ops.putMember.path, id), { method: ops.putMember.method, body: C.Member.parse(member) })); }
export async function removeBoardMember(id: string, userId: string) { return ops.removeMember.out.parse(await apiRequest(boardPath(ops.removeMember.path, id).replace(':userId', encodeURIComponent(userId)), { method: ops.removeMember.method })); }
export async function exportBoardPackage(id: string) {
  const operation = T.operations.exportBoard;
  return T.PortableBoardPackage.parse(await apiRequest(boardPath(operation.path,id), { method: operation.method }));
}
export async function previewBoardImport(input: T.ImportBoardInput) {
  const operation = T.operations.previewImport;
  return T.ImportBoardPreview.parse(await apiRequest(operation.path, { method: operation.method, body: T.ImportBoardInput.parse(input) }));
}
export async function importBoardPackage(input: T.ImportBoardInput) {
  const operation = T.operations.importBoard;
  return T.ImportBoardResult.parse(await apiRequest(operation.path, { method: operation.method, body: T.ImportBoardInput.parse(input) }));
}
