import { whiteboard as C, whiteboardImport as I } from '@repo/contracts';
import { whiteboardDiscussion as D } from '@repo/contracts';
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
const discussionPath=(path:string,boardId:string,values:Record<string,string>={})=>Object.entries({boardId,...values}).reduce((v,[key,value])=>v.replace(`:${key}`,encodeURIComponent(value)),path);
export type BoardThread = z.infer<typeof D.Thread>;
export async function listBoardThreads(boardId:string,cursor?:string){const op=D.operations.listThreads;const suffix=cursor?`?cursor=${encodeURIComponent(cursor)}`:'';return op.out.parse(await apiRequest(discussionPath(op.path,boardId)+suffix,{method:op.method}));}
export async function createBoardThread(boardId:string,input:z.infer<typeof D.CreateThread>){const op=D.operations.createThread;return op.out.parse(await apiRequest(discussionPath(op.path,boardId),{method:op.method,body:D.CreateThread.parse(input)}));}
export async function replyBoardThread(boardId:string,threadId:string,input:z.infer<typeof D.Reply>){const op=D.operations.reply;return op.out.parse(await apiRequest(discussionPath(op.path,boardId,{threadId}),{method:op.method,body:D.Reply.parse(input)}));}
export async function resolveBoardThread(boardId:string,threadId:string,resolved:boolean){const op=D.operations.resolveThread;return op.out.parse(await apiRequest(discussionPath(op.path,boardId,{threadId}),{method:op.method,body:{resolved}}));}
export async function createBoardTask(boardId:string,threadId:string,input:z.infer<typeof D.UpsertTask>){const op=D.operations.createTask;return op.out.parse(await apiRequest(discussionPath(op.path,boardId,{threadId}),{method:op.method,body:D.UpsertTask.parse(input)}));}
export async function updateBoardTask(boardId:string,taskId:string,input:z.infer<typeof D.UpdateTask>){const op=D.operations.updateTask;return op.out.parse(await apiRequest(discussionPath(op.path,boardId,{taskId}),{method:op.method,body:D.UpdateTask.parse(input)}));}
export async function importDiagram(id: string, input: I.ImportDiagramInput, sessionToken?: string) {
  const op = I.operations.importDiagram;
  return I.ImportDiagramResult.parse(await apiRequest(boardPath(op.path, id), {
    method: op.method, body: I.ImportDiagramInput.parse(input), sessionToken,
  }));
}
