import {
  WhiteboardAIProposal as WhiteboardAIProposalSchema, WhiteboardEventPage, WhiteboardOperationReceipt, WhiteboardPresentationState, WhiteboardRoomIdentity, type RenderedDiagramLayout,
  type WhiteboardAIProposal, type WhiteboardOperationActor, type WhiteboardOperationRequest,
} from '@repo/contracts/whiteboard-operation';
import { renderedLayoutToCommands } from '@repo/whiteboard-core';
import { apiUrl } from './api-client';

async function json(response:Response):Promise<unknown>{if(!response.ok)throw new Error(response.status===409?'BOARD_OPERATION_CONFLICT':response.status===403?'BOARD_OPERATION_FORBIDDEN':'BOARD_OPERATION_FAILED');return response.json();}
export async function executeBoardOperation(input:WhiteboardOperationRequest):Promise<ReturnType<typeof WhiteboardOperationReceipt.parse>>{
  const response=await fetch(apiUrl(`/v1/whiteboards/${encodeURIComponent(input.boardId)}/operations`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  return WhiteboardOperationReceipt.parse(await json(response));
}
export async function readBoardEvents(boardId:string,afterSeq=0,limit=100){
  const response=await fetch(apiUrl(`/v1/whiteboards/${encodeURIComponent(boardId)}/events?afterSeq=${afterSeq}&limit=${limit}`),{credentials:'include',cache:'no-store'});
  return WhiteboardEventPage.parse(await json(response));
}
export async function readBoardHead(boardId:string){const response=await fetch(apiUrl(`/v1/whiteboards/${boardId}/head`),{credentials:'include',cache:'no-store'});const value=await json(response) as{epoch:number;seq:number;role:'owner'|'editor'|'viewer'};if(!Number.isSafeInteger(value.epoch)||!Number.isSafeInteger(value.seq))throw new Error('BOARD_HEAD_INVALID');return value;}
export async function insertRenderedArtifact(input:{layout:RenderedDiagramLayout;actor?:WhiteboardOperationActor;boardId:string;boardOrgId?:string;epoch:number;seq:number;requestId:string;offset?:{x:number;y:number}}){
  if(input.actor&&input.boardOrgId)renderedLayoutToCommands(input.layout,input.actor,input.boardOrgId,input.offset);
  const response=await fetch(apiUrl(`/v1/whiteboards/${input.boardId}/artifact-handoffs`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:input.requestId,expectedRevision:{epoch:input.epoch,seq:input.seq},layout:input.layout,offset:input.offset??{x:0,y:0}})});return WhiteboardOperationReceipt.parse(await json(response));
}
export async function confirmAIProposal(proposal:WhiteboardAIProposal,requestId:string){
  const response=await fetch(apiUrl(`/v1/whiteboards/${proposal.boardId}/ai-proposals/${proposal.proposalId}/confirm`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,expectedRevision:proposal.baseRevision})});return WhiteboardOperationReceipt.parse(await json(response));
}
export async function readAIProposal(boardId:string,proposalId:string){const response=await fetch(apiUrl(`/v1/whiteboards/${boardId}/ai-proposals/${proposalId}`),{credentials:'include',cache:'no-store'});return WhiteboardAIProposalSchema.parse(await json(response));}
export async function cancelAIProposal(proposal:WhiteboardAIProposal){const response=await fetch(apiUrl(`/v1/whiteboards/${proposal.boardId}/ai-proposals/${proposal.proposalId}/cancel`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:proposal.baseRevision})});return WhiteboardAIProposalSchema.parse(await json(response));}
export async function readPresentation(boardId:string,roomId:string){const response=await fetch(apiUrl(`/v1/whiteboards/${boardId}/presentation?roomId=${encodeURIComponent(roomId)}`),{credentials:'include',cache:'no-store'});return WhiteboardPresentationState.parse(await json(response));}
export async function updatePresentation(boardId:string,roomId:string,command:unknown){const response=await fetch(apiUrl(`/v1/whiteboards/${boardId}/presentation`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,command})});return WhiteboardPresentationState.parse(await json(response));}
export async function joinBoardRoom(boardId:string,input:{roomId:string;deviceId:string;deviceKind:'personal'|'meeting-display';reconnectToken?:string}){const response=await fetch(apiUrl(`/v1/whiteboards/${boardId}/rooms/join`),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return WhiteboardRoomIdentity.parse(await json(response));}
