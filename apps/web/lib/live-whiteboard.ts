import { whiteboard as C, whiteboardImport as I, whiteboardMiro as MM, whiteboardMural as MU, whiteboardTransfer as T } from '@repo/contracts';
import type { z } from 'zod';
import { apiRequest } from './api-client';
export type Board = C.Board;
export type BoardMember = z.infer<typeof C.Member>;
export type CreateBoardInput = z.infer<typeof C.CreateBoard>;
export type UpdateBoardInput = z.infer<typeof C.UpdateBoard>;
const ops = C.operations;
const boardPath = (path: string, id: string) => path.replace(':boardId', encodeURIComponent(id));
export async function listBoards(sessionToken?: string) { return ops.listBoards.out.parse(await apiRequest(ops.listBoards.path, { method: ops.listBoards.method, sessionToken })).items; }
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
export async function getMiroConnection() {
  const operation = MM.operations.connection;
  return MM.MiroConnection.parse(await apiRequest(operation.path, { method: operation.method }));
}
export async function startMiroOAuth(input: MM.StartMiroOAuthInput) {
  const operation = MM.operations.startOAuth;
  return MM.StartMiroOAuthResult.parse(await apiRequest(operation.path, {
    method: operation.method,
    body: MM.StartMiroOAuthInput.parse(input),
  }));
}
export async function completeMiroOAuth(input: MM.CompleteMiroOAuthInput) {
  const operation = MM.operations.completeOAuth;
  return MM.CompleteMiroOAuthResult.parse(await apiRequest(operation.path, {
    method: operation.method,
    body: MM.CompleteMiroOAuthInput.parse(input),
  }));
}
export async function listMiroBoards(query: unknown) {
  const operation = MM.operations.listBoards;
  const parsed = MM.ListMiroBoardsQuery.parse(query);
  return MM.ListMiroBoardsResult.parse(await apiRequest(operation.path, {
    method: operation.method,
    query: { offset: String(parsed.offset), limit: String(parsed.limit) },
  }));
}
export async function previewMiroBoard(input: MM.PreviewMiroBoardInput) {
  const operation = MM.operations.previewBoard;
  return MM.PreviewMiroBoardResult.parse(await apiRequest(operation.path, {
    method: operation.method,
    body: MM.PreviewMiroBoardInput.parse(input),
  }));
}
export async function disconnectMiro() {
  const operation = MM.operations.disconnect;
  return operation.out.parse(await apiRequest(operation.path, { method: operation.method }));
}
export async function getMuralConnection() {
  const operation = MU.operations.connection;
  return MU.MuralConnection.parse(await apiRequest(operation.path, { method: operation.method }));
}
export async function startMuralOAuth(input: MU.StartMuralOAuthInput) {
  const operation = MU.operations.startOAuth;
  return MU.StartMuralOAuthResult.parse(await apiRequest(operation.path, { method: operation.method, body: MU.StartMuralOAuthInput.parse(input) }));
}
export async function completeMuralOAuth(input: MU.CompleteMuralOAuthInput) {
  const operation = MU.operations.completeOAuth;
  return MU.CompleteMuralOAuthResult.parse(await apiRequest(operation.path, { method: operation.method, body: MU.CompleteMuralOAuthInput.parse(input) }));
}
export async function listMuralWorkspaces(query: unknown) {
  const operation = MU.operations.listWorkspaces, parsed = MU.PageQuery.parse(query);
  return MU.ListMuralWorkspacesResult.parse(await apiRequest(operation.path, { method: operation.method, query: { limit: String(parsed.limit), ...(parsed.next ? { next: parsed.next } : {}) } }));
}
export async function listWorkspaceMurals(query: unknown) {
  const operation = MU.operations.listMurals, parsed = MU.ListWorkspaceMuralsQuery.parse(query);
  return MU.ListWorkspaceMuralsResult.parse(await apiRequest(operation.path, { method: operation.method, query: { workspaceId: parsed.workspaceId, limit: String(parsed.limit), ...(parsed.next ? { next: parsed.next } : {}) } }));
}
export async function previewMural(input: MU.PreviewMuralInput) {
  const operation = MU.operations.preview;
  return MU.PreviewMuralResult.parse(await apiRequest(operation.path, { method: operation.method, body: MU.PreviewMuralInput.parse(input) }));
}
export async function disconnectMural() {
  const operation = MU.operations.disconnect;
  return operation.out.parse(await apiRequest(operation.path, { method: operation.method }));
}
export async function importDiagram(id: string, input: I.ImportDiagramInput, sessionToken?: string) {
  const op = I.operations.importDiagram;
  return I.ImportDiagramResult.parse(await apiRequest(boardPath(op.path, id), {
    method: op.method, body: I.ImportDiagramInput.parse(input), sessionToken,
  }));
}
