import * as C from '@repo/contracts/whiteboard-proposal';
import { apiRequest } from './api-client';
const path=(template:string,boardId:string,proposalId?:string)=>template.replace(':boardId',encodeURIComponent(boardId)).replace(':proposalId',encodeURIComponent(proposalId??''));
export async function listWhiteboardProposals(boardId:string){const op=C.operations.list;return op.out.parse(await apiRequest(path(op.path,boardId),{method:op.method})).items;}
export async function decideWhiteboardProposal(boardId:string,proposalId:string,action:'accept'|'reject',requestId:string){const op=C.operations[action];return op.out.parse(await apiRequest(path(op.path,boardId,proposalId),{method:op.method,body:C.DecideProposal.parse({requestId})}));}
export async function batchDecideWhiteboardProposals(boardId:string,input:C.BatchDecision){
  const op=C.operations.batchDecide;
  return op.out.parse(await apiRequest(path(op.path,boardId),{method:op.method,body:op.in.parse(input)}));
}
