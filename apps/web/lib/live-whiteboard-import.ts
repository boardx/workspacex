import { apiRequest } from './api-client';

export type WhiteboardImportReport={importId:string;counts:{discovered:number;accepted:number;unsupported:number;assets:number};items:Array<{sourceId:string;sourceType:string;outcome:'success'|'downgraded'|'skipped'|'failed';reasonCode:string|null;detail:string|null}>;issues:Array<{code:string;detail:string}>;exportFormat:'workspacex.whiteboard-import-report.v1';executable:boolean};
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
