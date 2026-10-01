import {
  WhiteboardAIProposal as WhiteboardAIProposalSchema, WhiteboardAIConfirmReceipt, WhiteboardEventPage, WhiteboardOperationReceipt, WhiteboardPresentationState, WhiteboardRoomIdentity, type RenderedDiagramLayout,
  type WhiteboardAIProposal, type WhiteboardOperationActor, type WhiteboardOperationRequest,
} from '@repo/contracts/whiteboard-operation';
import { renderedLayoutToCommands } from '@repo/whiteboard-core';
import { apiRequest, ApiError } from './api-client';

// Reuse the shared bearer/session transport; cookies alone never authenticate Board.
async function boardRequest(path:string,opts:RequestInit={}):Promise<unknown>{try{return await apiRequest(path,{method:opts.method as 'GET'|'POST'|undefined,body:typeof opts.body==='string'?JSON.parse(opts.body):undefined});}catch(error){if(error instanceof ApiError)throw new Error(error.status===409?'BOARD_OPERATION_CONFLICT':error.status===403?'BOARD_OPERATION_FORBIDDEN':'BOARD_OPERATION_FAILED');throw error;}}
export async function executeBoardOperation(input:WhiteboardOperationRequest):Promise<ReturnType<typeof WhiteboardOperationReceipt.parse>>{
  const response=await boardRequest(`/v1/whiteboards/${encodeURIComponent(input.boardId)}/operations`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  return WhiteboardOperationReceipt.parse(response);
}
export async function readBoardEvents(boardId:string,afterSeq=0,limit=100){
  const response=await boardRequest(`/v1/whiteboards/${encodeURIComponent(boardId)}/events?afterSeq=${afterSeq}&limit=${limit}`,{credentials:'include',cache:'no-store'});
  return WhiteboardEventPage.parse(response);
}
export async function readBoardHead(boardId:string){const response=await boardRequest(`/v1/whiteboards/${boardId}/head`,{credentials:'include',cache:'no-store'});const value=response as{epoch:number;seq:number;role:'owner'|'editor'|'viewer'};if(!Number.isSafeInteger(value.epoch)||!Number.isSafeInteger(value.seq))throw new Error('BOARD_HEAD_INVALID');return value;}
export async function insertRenderedArtifact(input:{layout:RenderedDiagramLayout;actor?:WhiteboardOperationActor;boardId:string;boardOrgId?:string;epoch:number;seq:number;requestId:string;offset?:{x:number;y:number}}){
  if(input.actor&&input.boardOrgId)renderedLayoutToCommands(input.layout,input.actor,input.boardOrgId,input.offset);
  const response=await boardRequest(`/v1/whiteboards/${input.boardId}/artifact-handoffs`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:input.requestId,expectedRevision:{epoch:input.epoch,seq:input.seq},layout:input.layout,offset:input.offset??{x:0,y:0}})});return WhiteboardOperationReceipt.parse(response);
}
export async function confirmAIProposal(proposal:WhiteboardAIProposal,requestId:string){
  const response=await boardRequest(`/v1/whiteboards/${proposal.boardId}/ai-proposals/${proposal.proposalId}/confirm`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,expectedRevision:proposal.baseRevision})});return WhiteboardAIConfirmReceipt.parse(response);
}
const BoardAIUndoTarget=WhiteboardAIProposalSchema.pick({proposalId:true,boardId:true}).extend({
  operationId:WhiteboardAIConfirmReceipt.shape.operationId,
  expectedRevision:WhiteboardAIConfirmReceipt.shape.undoReceipt.shape.expectedRevision,
  createdAt:WhiteboardAIConfirmReceipt.shape.undoReceipt.shape.createdAt,
}).strict();
export type BoardAIUndoTarget=ReturnType<typeof BoardAIUndoTarget.parse>;
const boardUndoKey=(boardId:string)=>`board-undo-receipt:${boardId}`;
const legacyBoardUndoKey=(boardId:string)=>`board-undo-receipts:${boardId}`;
export function recordBoardUndoReceipt(proposal:WhiteboardAIProposal,receipt:ReturnType<typeof WhiteboardAIConfirmReceipt.parse>):BoardAIUndoTarget{
  const target=BoardAIUndoTarget.parse({boardId:receipt.boardId,proposalId:proposal.proposalId,operationId:receipt.operationId,expectedRevision:receipt.undoReceipt.expectedRevision,createdAt:receipt.undoReceipt.createdAt});
  sessionStorage.removeItem(legacyBoardUndoKey(receipt.boardId));
  sessionStorage.setItem(boardUndoKey(receipt.boardId),JSON.stringify(target));
  return target;
}
export function readBoardUndoReceipt(boardId:string):BoardAIUndoTarget|null{
  sessionStorage.removeItem(legacyBoardUndoKey(boardId));
  const raw=sessionStorage.getItem(boardUndoKey(boardId));
  if(!raw)return null;
  try{const target=BoardAIUndoTarget.parse(JSON.parse(raw));if(target.boardId!==boardId)throw new Error('BOARD_UNDO_BOARD_MISMATCH');return target;}catch{sessionStorage.removeItem(boardUndoKey(boardId));return null;}
}
export function clearBoardUndoReceipt(boardId:string,operationId?:string){
  const target=readBoardUndoReceipt(boardId);
  if(target&&(!operationId||target.operationId===operationId))sessionStorage.removeItem(boardUndoKey(boardId));
}
export async function readAIProposal(boardId:string,proposalId:string){const response=await boardRequest(`/v1/whiteboards/${boardId}/ai-proposals/${proposalId}`,{credentials:'include',cache:'no-store'});return WhiteboardAIProposalSchema.parse(response);}
export async function cancelAIProposal(proposal:WhiteboardAIProposal){const response=await boardRequest(`/v1/whiteboards/${proposal.boardId}/ai-proposals/${proposal.proposalId}/cancel`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:proposal.baseRevision})});return WhiteboardAIProposalSchema.parse(response);}
export async function readPresentation(boardId:string,roomId:string){const response=await boardRequest(`/v1/whiteboards/${boardId}/presentation?roomId=${encodeURIComponent(roomId)}`,{credentials:'include',cache:'no-store'});return WhiteboardPresentationState.parse(response);}
export async function updatePresentation(boardId:string,roomId:string,command:unknown,reconnectToken:string|null=null){const response=await boardRequest(`/v1/whiteboards/${boardId}/presentation`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,reconnectToken,command})});return WhiteboardPresentationState.parse(response);}
export async function joinBoardRoom(boardId:string,input:{roomId:string;deviceId:string;deviceKind:'personal'|'meeting-display';reconnectToken?:string}){const response=await boardRequest(`/v1/whiteboards/${boardId}/rooms/join`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return WhiteboardRoomIdentity.parse(response);}
export async function organizeBoard(boardId:string,actorId:string,objectIds:string[]){const head=await readBoardHead(boardId),expectedRevision={epoch:head.epoch,seq:head.seq};const response=await boardRequest(`/v1/whiteboards/${boardId}/ai-organize`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),actorId,objectIds,expectedRevision})});return WhiteboardAIProposalSchema.parse(response);}
export async function boardOrganizeActors(boardId:string){const {BoardOrganizeActors}=await import('@repo/contracts/whiteboard-organize');return BoardOrganizeActors.parse(await boardRequest(`/v1/whiteboards/${boardId}/ai-organize/actors`,{credentials:'include',cache:'no-store'}));}
export async function undoAIProposal(proposal:Pick<WhiteboardAIProposal,'boardId'|'proposalId'>,expectedRevision:{epoch:number;seq:number}){const response=await boardRequest(`/v1/whiteboards/${proposal.boardId}/ai-proposals/${proposal.proposalId}/undo`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision})});return WhiteboardOperationReceipt.parse(response);}
