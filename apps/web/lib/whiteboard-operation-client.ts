import {
  WhiteboardEventPage, WhiteboardOperationReceipt, type RenderedDiagramLayout,
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
export async function insertRenderedArtifact(input:{layout:RenderedDiagramLayout;actor:WhiteboardOperationActor;boardId:string;boardOrgId:string;epoch:number;seq:number;requestId:string;offset?:{x:number;y:number}}){
  const commands=renderedLayoutToCommands(input.layout,input.actor,input.boardOrgId,input.offset);
  return executeBoardOperation({apiVersion:'2026-09-01',requestId:input.requestId,boardId:input.boardId,expectedRevision:{epoch:input.epoch,seq:input.seq},actor:input.actor,commands,
    provenance:{source:'chat-artifact',model:null,skill:null,sourceArtifactId:input.layout.artifactId,sourceRevision:input.layout.sourceRevision,layoutHash:input.layout.layoutHash,inputObjectIds:[]}});
}
export async function confirmAIProposal(proposal:WhiteboardAIProposal,requestId:string){
  return executeBoardOperation({apiVersion:'2026-09-01',requestId,boardId:proposal.boardId,expectedRevision:proposal.baseRevision,actor:proposal.createdBy,commands:proposal.action.commands,provenance:proposal.provenance});
}
