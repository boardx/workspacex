import { apiRequest } from './api-client';
import type { WhiteboardImportReport } from '@repo/contracts/whiteboard-import';

export type { WhiteboardImportReport };
type ImportStatus={importId:string;sourceBoardId:string;sourceRevision:string;stage:'uploaded'|'preflighted'|'completed'|'failed'};
const root=(boardId:string)=>`/whiteboards/${encodeURIComponent(boardId)}/imports`;

export async function uploadWhiteboardImport(boardId:string, input:unknown) {
  return apiRequest<ImportStatus>(root(boardId),{method:'POST',body:input});
}
export async function preflightWhiteboardImport(boardId:string,importId:string,requestId:string) {
  return apiRequest<WhiteboardImportReport>(`${root(boardId)}/${encodeURIComponent(importId)}/preflight`,{method:'POST',body:{requestId}});
}
export async function executeWhiteboardImport(boardId:string,importId:string,requestId:string,expectedEpoch:number) {
  return apiRequest<{status:ImportStatus;report:WhiteboardImportReport;epoch:number;seq:number;replayed:boolean}>(`${root(boardId)}/${encodeURIComponent(importId)}/execute`,{method:'POST',body:{requestId,expectedEpoch}});
}

export async function exportPortableBoard(boardId:string){return apiRequest<{fileName:string;mime:'application/json';contentBase64:string;sha256:string;sizeBytes:number}>(`/whiteboards/${encodeURIComponent(boardId)}/portable/export`,{method:'POST',body:{}});}
export async function importPortableBoard(boardId:string,input:unknown){return apiRequest<{epoch:number;seq:number;replayed:boolean;objectCount:number;assetCount:number}>(`/whiteboards/${encodeURIComponent(boardId)}/portable/import`,{method:'POST',body:input});}
