import { WhiteboardCommentCommand, WhiteboardCommentThread, whiteboardCollaborationOperations as Operations, type WhiteboardCommentThread as CommentThread } from "@repo/contracts/whiteboard-collaboration";
import { apiRequest } from "@/lib/api-client";

export async function listBoardCommentThreads(boardId:string,signal?:AbortSignal):Promise<CommentThread[]> {
  const response=await apiRequest<unknown>(Operations.listComments.path.replace(":boardId",encodeURIComponent(boardId)),{signal});
  return Operations.listComments.out.parse(response).items;
}
export async function dispatchBoardCommentCommand(boardId:string,command:unknown):Promise<{operationId:string;replayed:boolean;threads:CommentThread[]}> {
  const parsed=WhiteboardCommentCommand.parse(command);
  const response=await apiRequest<unknown>(Operations.dispatchComment.path.replace(":boardId",encodeURIComponent(boardId)),{method:"POST",body:parsed});
  const accepted=Operations.dispatchComment.out.parse(response);
  return {operationId:accepted.operationId,replayed:accepted.replayed,threads:accepted.threads.map(item=>WhiteboardCommentThread.parse(item))};
}
