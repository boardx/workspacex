import { WhiteboardImageError, type WhiteboardImageAssets } from './image-assets';
import { createHash } from 'node:crypto';
import { whiteboardImport as C } from '@repo/contracts';
import { mapImportedBoard } from '@repo/whiteboard-core';
import { createWhiteboardDocument,readObjects } from '@repo/whiteboard-core';
import * as Y from 'yjs';
import type { Principal } from '../../domain/principal';
import { ObjectExistsError, type ObjectStore } from '../artifact/ports';
import type { WhiteboardRepository } from './ports';
import type { WhiteboardCollaborationStore } from './collaboration-ports';
import { parseWhiteboardImport, UnsafeWhiteboardImport } from './import-parser';

export const WHITEBOARD_IMPORT_SERVICE=Symbol('WhiteboardImportService');
export type ImportStatus=ReturnType<typeof C.WhiteboardImportStatus.parse>;
export type ImportReport=ReturnType<typeof C.WhiteboardImportReport.parse>;
export interface WhiteboardImportRecord extends ImportStatus { sourceObjectKey:string; actorId:string; report:ImportReport|null; executeRequestId:string|null; executeRequestHash:string|null; completedEpoch:number|null; completedSeq:number|null; }
export interface WhiteboardImportRepository {
  create(principal:Principal,record:WhiteboardImportRecord):Promise<{record:WhiteboardImportRecord;replayed:boolean;conflict:boolean}>;
  get(principal:Principal,boardId:string,importId:string):Promise<WhiteboardImportRecord|null>;
  savePreflight(principal:Principal,record:WhiteboardImportRecord,requestId:string,report:ImportReport):Promise<WhiteboardImportRecord>;
  claimExecution(principal:Principal,record:WhiteboardImportRecord,input:{requestId:string;requestHash:string}):Promise<{record:WhiteboardImportRecord;conflict:boolean}>;
  releaseExecution(principal:Principal,record:WhiteboardImportRecord,input:{requestId:string;requestHash:string}):Promise<void>;
  reserveAssets(principal:Principal,record:WhiteboardImportRecord,assets:Array<{objectKey:string;contentHash:string;byteSize:number}>):Promise<void>;
  releaseExpiredAssets(principal:Principal,now:Date):Promise<number>;
  complete(principal:Principal,record:WhiteboardImportRecord,input:{requestId:string;requestHash:string;epoch:number;seq:number;report:ImportReport;assetRefs:Array<{objectKey:string;contentHash:string;byteSize:number}>}):Promise<WhiteboardImportRecord>;
}
export interface WhiteboardExportRecord { exportId:string; boardId:string; actorId:string; requestHash:string; epoch:number; seq:number; objectKey:string; sha256:string; sizeBytes:number; fileName:string; createdAt:string }
export interface WhiteboardExportRepository {
  create(principal:Principal,record:WhiteboardExportRecord):Promise<{record:WhiteboardExportRecord;replayed:boolean;conflict:boolean}>;
  get(principal:Principal,boardId:string,exportId:string):Promise<WhiteboardExportRecord|null>;
}
export class WhiteboardImportError extends Error { constructor(readonly code:C.WhiteboardImportFailure){super(code);this.name='WhiteboardImportError';} }
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const status=(record:WhiteboardImportRecord):ImportStatus=>C.WhiteboardImportStatus.parse({importId:record.importId,boardId:record.boardId,source:record.source,sourceBoardId:record.sourceBoardId,sourceRevision:record.sourceRevision,fileName:record.fileName,mimeType:record.mimeType,sizeBytes:record.sizeBytes,sha256:record.sha256,stage:record.stage,counts:record.counts,createdAt:record.createdAt,updatedAt:record.updatedAt});
const sourceImportId=(source:string,boardId:string,revision:string)=>{const value=hash(`${source}\0${boardId}\0${revision}`);return`${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;};

export class WhiteboardImportService {
  constructor(private readonly boards:WhiteboardRepository,private readonly imports:WhiteboardImportRepository,private readonly collaboration:WhiteboardCollaborationStore,private readonly objects:Pick<ObjectStore,'putOnce'|'get'|'head'>,private readonly exports:WhiteboardExportRepository,private readonly now:()=>Date=()=>new Date(),private readonly images?:WhiteboardImageAssets){}
  private async access(principal:Principal,boardId:string){const board=await this.boards.get(principal,boardId);if(!board)throw new WhiteboardImportError('NOT_FOUND');if(board.role==='viewer')throw new WhiteboardImportError('FORBIDDEN');if(board.archived)throw new WhiteboardImportError('ARCHIVED');return board;}
  private prefix(principal:Principal,boardId:string){return`whiteboards/tenants/${hash(principal.orgId).slice(0,32)}/boards/${boardId}`;}
  private decode(value:string):Uint8Array{if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new WhiteboardImportError('INVALID_UPLOAD');return new Uint8Array(Buffer.from(value,'base64'));}
  private async putVerified(key:string,bytes:Uint8Array,mime:string){try{await this.objects.putOnce(key,bytes,mime);}catch(error){if(!(error instanceof ObjectExistsError))throw new WhiteboardImportError('DEPENDENCY_UNAVAILABLE');}let body:Uint8Array|null,head:{sizeBytes:number;mime:string}|null;try{[body,head]=await Promise.all([this.objects.get(key),this.objects.head(key)]);}catch{throw new WhiteboardImportError('DEPENDENCY_UNAVAILABLE');}if(!body||!head||body.byteLength!==bytes.byteLength||head.sizeBytes!==bytes.byteLength||hash(body)!==hash(bytes))throw new WhiteboardImportError('INTEGRITY_FAILED');}
  private async source(principal:Principal,record:WhiteboardImportRecord){if(!record.sourceObjectKey.startsWith(`${this.prefix(principal,record.boardId)}/imports/${record.importId}/`))throw new WhiteboardImportError('INTEGRITY_FAILED');let bytes:Uint8Array|null;try{bytes=await this.objects.get(record.sourceObjectKey);}catch{throw new WhiteboardImportError('DEPENDENCY_UNAVAILABLE');}if(!bytes||bytes.byteLength!==record.sizeBytes||hash(bytes)!==record.sha256)throw new WhiteboardImportError('INTEGRITY_FAILED');return bytes;}
  async upload(principal:Principal,boardId:string,input:unknown):Promise<ImportStatus>{await this.access(principal,boardId);const request=C.UploadWhiteboardImport.parse(input),bytes=this.decode(request.contentBase64);if(bytes.byteLength!==request.sizeBytes||hash(bytes)!==request.sha256)throw new WhiteboardImportError('INVALID_UPLOAD');let parsed;try{parsed=await parseWhiteboardImport(bytes,request.mimeType,request.source);}catch(error){if(error instanceof UnsafeWhiteboardImport)throw new WhiteboardImportError(error.code);throw error;}const embedded=parsed.sourceIdentity,sourceBoardId=embedded.boardId??`digest:${request.sha256}`,sourceRevision=embedded.revision??request.sha256,importId=sourceImportId(request.source,sourceBoardId,sourceRevision),key=`${this.prefix(principal,boardId)}/imports/${importId}/source/${request.sha256}`;await this.putVerified(key,bytes,request.mimeType);const now=this.now().toISOString(),record:WhiteboardImportRecord={importId,boardId,source:request.source,sourceBoardId,sourceRevision,fileName:request.fileName,mimeType:request.mimeType,sizeBytes:request.sizeBytes,sha256:request.sha256,stage:'uploaded',counts:null,createdAt:now,updatedAt:now,sourceObjectKey:key,actorId:principal.userId,report:null,executeRequestId:null,executeRequestHash:null,completedEpoch:null,completedSeq:null};const saved=await this.imports.create(principal,record);if(saved.conflict)throw new WhiteboardImportError('IDEMPOTENCY_CONFLICT');return status(saved.record);}
  private report(record:WhiteboardImportRecord,mapped:ReturnType<typeof mapImportedBoard>,skipped:string[]):ImportReport{return C.WhiteboardImportReport.parse({importId:record.importId,counts:{discovered:mapped.discovered,accepted:mapped.accepted,unsupported:mapped.unsupported,assets:mapped.assets},issues:[...mapped.issues,...skipped.slice(0,Math.max(0,C.WHITEBOARD_IMPORT_LIMITS.issues-mapped.issues.length)).map(path=>({code:'FILE_SKIPPED' as const,sourceId:null,sourceType:null,detail:`Unsupported archive entry ${path}`}))],items:mapped.outcomes,exportFormat:'workspacex.whiteboard-import-report.v1',executable:mapped.commands.length>0});}
  private async prepare(principal:Principal,record:WhiteboardImportRecord,storeAssets:boolean) {
    const bytes=await this.source(principal,record);
    let parsed;
    try { parsed=await parseWhiteboardImport(bytes,record.mimeType,record.source); }
    catch(error) { if(error instanceof UnsafeWhiteboardImport)throw new WhiteboardImportError(error.code);throw error; }
    const assetRefs:Array<{objectKey:string;contentHash:string;byteSize:number}>=[];
    for (const asset of parsed.assets) {
      if (!this.images) throw new WhiteboardImportError('DEPENDENCY_UNAVAILABLE');
      const matching = parsed.items.filter(item => item.assetRef === asset.path);
      if (!matching.length) continue;
      try {
        const metadata = storeAssets ? await this.images.upload(principal,record.boardId,asset.bytes,asset.mime)
          : await this.images.inspect(principal,record.boardId,asset.bytes,asset.mime);
        for (const item of matching) { item.assetRef=metadata.assetId;item.assetMetadata=metadata; }
      } catch (error) {
        if (error instanceof WhiteboardImageError && (error.code === 'INVALID_IMAGE' || error.code === 'IMAGE_TOO_LARGE')) {
          for (const item of matching) item.assetRef=null;
          parsed.skipped.push(asset.path);
        } else if (error instanceof WhiteboardImageError) throw new WhiteboardImportError(error.code === 'FORBIDDEN' ? 'FORBIDDEN' : error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'DEPENDENCY_UNAVAILABLE');
        else throw error;
      }
    }
    const mapped=mapImportedBoard(record.source,record.importId,parsed.items,C.WHITEBOARD_IMPORT_LIMITS.objects);
    return {mapped,assetRefs,report:this.report(record,mapped,parsed.skipped)};
  }
  async preflight(principal:Principal,boardId:string,importId:string,input:unknown):Promise<ImportReport>{await this.access(principal,boardId);const action=C.WhiteboardImportAction.parse(input),record=await this.imports.get(principal,boardId,importId);if(!record)throw new WhiteboardImportError('NOT_FOUND');if(record.report&&record.stage!=='uploaded')return record.report;const prepared=await this.prepare(principal,record,false);await this.imports.savePreflight(principal,record,action.requestId,prepared.report);return prepared.report;}
  async execute(principal:Principal,boardId:string,importId:string,input:unknown){await this.access(principal,boardId);const action=C.ExecuteWhiteboardImport.parse(input);let record=await this.imports.get(principal,boardId,importId);if(!record)throw new WhiteboardImportError('NOT_FOUND');const requestHash=hash(JSON.stringify({importId,expectedEpoch:action.expectedEpoch}));if(record.executeRequestId){if(record.executeRequestId!==action.requestId||record.executeRequestHash!==requestHash)throw new WhiteboardImportError('IDEMPOTENCY_CONFLICT');if(record.completedEpoch!==null&&record.completedSeq!==null&&record.report)return{status:status(record),report:record.report,epoch:record.completedEpoch,seq:record.completedSeq,replayed:true};}else{const claimed=await this.imports.claimExecution(principal,record,{requestId:action.requestId,requestHash});if(claimed.conflict)throw new WhiteboardImportError('IDEMPOTENCY_CONFLICT');record=claimed.record;}const prepared=await this.prepare(principal,record,true);if(!prepared.report.executable)throw new WhiteboardImportError('UNSUPPORTED_FORMAT');let ack;try{ack=await this.collaboration.writeCommands(principal,boardId,{epoch:action.expectedEpoch,requestId:action.requestId,commands:prepared.mapped.commands});}catch(error){const code=(error as{code?:string}).code;if(code==='STALE_EPOCH'){await this.imports.releaseExecution(principal,record,{requestId:action.requestId,requestHash});throw new WhiteboardImportError('STALE_HEAD');}if(code==='IDEMPOTENCY_CONFLICT')throw new WhiteboardImportError('IDEMPOTENCY_CONFLICT');throw error;}const completed=await this.imports.complete(principal,record,{requestId:action.requestId,requestHash,epoch:ack.epoch,seq:ack.seq,report:prepared.report,assetRefs:prepared.assetRefs});return{status:status(completed),report:prepared.report,epoch:ack.epoch,seq:ack.seq,replayed:ack.replayed};}
  async getStatus(principal:Principal,boardId:string,importId:string){await this.access(principal,boardId);const record=await this.imports.get(principal,boardId,importId);if(!record)throw new WhiteboardImportError('NOT_FOUND');return status(record);}
  async getReport(principal:Principal,boardId:string,importId:string){await this.access(principal,boardId);const record=await this.imports.get(principal,boardId,importId);if(!record||!record.report)throw new WhiteboardImportError('NOT_FOUND');return record.report;}
  private exportResult(record:WhiteboardExportRecord,replayed:boolean,contentBase64?:string){return C.StandardWhiteboardExport.parse({format:'workspacex.board.v1',exportId:record.exportId,boardId:record.boardId,epoch:record.epoch,seq:record.seq,sha256:record.sha256,sizeBytes:record.sizeBytes,fileName:record.fileName,objectKey:record.objectKey,downloadPath:`/whiteboards/${record.boardId}/imports/standard-export/${record.exportId}`,replayed,...(contentBase64?{contentBase64}:{})});}
  async standardExport(principal:Principal,boardId:string,input:unknown){await this.access(principal,boardId);const action=C.StandardWhiteboardExportRequest.parse(input),state=await this.collaboration.load(principal,boardId),doc=createWhiteboardDocument();Y.applyUpdate(doc,state.update);const body={format:'workspacex.board.v1',board:{id:boardId,epoch:state.epoch,seq:state.seq},objects:readObjects(doc)},bytes=new TextEncoder().encode(JSON.stringify(body)),sha256=hash(bytes),requestHash=hash(JSON.stringify({boardId,epoch:state.epoch,seq:state.seq,sha256})),fileName=`board-${boardId}-e${state.epoch}-s${state.seq}.json`,objectKey=`${this.prefix(principal,boardId)}/exports/${action.requestId}/${sha256}.json`;doc.destroy();await this.putVerified(objectKey,bytes,'application/json');const created=await this.exports.create(principal,{exportId:action.requestId,boardId,actorId:principal.userId,requestHash,epoch:state.epoch,seq:state.seq,objectKey,sha256,sizeBytes:bytes.byteLength,fileName,createdAt:this.now().toISOString()});if(created.conflict)throw new WhiteboardImportError('IDEMPOTENCY_CONFLICT');return this.exportResult(created.record,created.replayed);}
  async downloadStandardExport(principal:Principal,boardId:string,exportId:string){await this.access(principal,boardId);const record=await this.exports.get(principal,boardId,exportId);if(!record)throw new WhiteboardImportError('NOT_FOUND');if(!record.objectKey.startsWith(`${this.prefix(principal,boardId)}/exports/${exportId}/`))throw new WhiteboardImportError('INTEGRITY_FAILED');let bytes:Uint8Array|null,head:{sizeBytes:number;mime:string}|null;try{[bytes,head]=await Promise.all([this.objects.get(record.objectKey),this.objects.head(record.objectKey)]);}catch{throw new WhiteboardImportError('DEPENDENCY_UNAVAILABLE');}if(!bytes||!head||bytes.byteLength!==record.sizeBytes||head.sizeBytes!==record.sizeBytes||head.mime!=='application/json'||hash(bytes)!==record.sha256)throw new WhiteboardImportError('INTEGRITY_FAILED');const {replayed:_,...metadata}=this.exportResult(record,false);return C.StandardWhiteboardExportDownload.parse({...metadata,contentBase64:Buffer.from(bytes).toString('base64')});}
}
