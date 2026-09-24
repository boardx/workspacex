import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as W, whiteboardFileExport as C } from '@repo/contracts';
import { BoardFileExportFailure, boardExportFilename, createBoardFileArtifact } from '@repo/whiteboard-core';
import { ObjectStoreUnavailableError, type ObjectStore } from '../artifact/ports';
import type { Principal } from '../../domain/principal';
import { WhiteboardFileExportError as Fault, type WhiteboardFileExportContent, type WhiteboardFileExportRepository, type WhiteboardFileExportService, type WhiteboardFileExportSource, type WhiteboardFileRenderer } from './file-export-ports';

const MIME:Record<C.BoardFileExportFormat,string>={png:'image/png',svg:'image/svg+xml',pdf:'application/pdf','sticky-csv':'text/csv; charset=utf-8'};
const EXTENSION:Record<C.BoardFileExportFormat,string>={png:'png',svg:'svg',pdf:'pdf','sticky-csv':'csv'};

/** Durable metadata + immutable blob bytes. The map contains abort handles only, never job truth or artifacts. */
export class DefaultWhiteboardFileExportService implements WhiteboardFileExportService {
  private readonly active=new Map<string,AbortController>();
  constructor(private readonly source:WhiteboardFileExportSource,private readonly repository:WhiteboardFileExportRepository,
    private readonly objects:ObjectStore,private readonly renderer:WhiteboardFileRenderer,
    private readonly schedule:(task:()=>Promise<void>)=>void=task=>{queueMicrotask(()=>void task());}){}

  async create(principal:Principal,boardId:string,raw:C.BoardFileExportInput):Promise<C.BoardFileExportStatus>{
    if(!W.BoardId.safeParse(boardId).success)throw new Fault('VALIDATION_FAILED');const parsed=C.BoardFileExportInput.safeParse(raw);if(!parsed.success)throw new Fault('VALIDATION_FAILED');
    const snapshot=await this.source.load(principal,boardId),jobId=randomUUID(),extension=EXTENSION[parsed.data.format];
    const status=C.BoardFileExportStatus.parse({jobId,boardId,format:parsed.data.format,status:'queued',progress:0,filename:boardExportFilename(snapshot.boardName,extension),mimeType:MIME[parsed.data.format],objectCount:0,pageOrder:[],losses:[],sizeBytes:null,errorCode:null});
    await this.repository.create(principal,status,parsed.data);this.schedule(()=>this.run(principal,parsed.data,status,snapshot));return status;
  }
  private async run(principal:Principal,input:C.BoardFileExportInput,initial:C.BoardFileExportStatus,snapshot:Awaited<ReturnType<WhiteboardFileExportSource['load']>>):Promise<void>{
    const controller=new AbortController();this.active.set(initial.jobId,controller);let status:C.BoardFileExportStatus={...initial,status:'running',progress:10};
    try{
      await this.repository.running(principal,initial.jobId,10);const hooks=input.format==='sticky-csv'?{}:await this.renderer.hooks(snapshot.objects,input.format);
      const artifact=await createBoardFileArtifact({...input,actorId:principal.userId,role:snapshot.role,boardName:snapshot.boardName,objects:snapshot.objects},{...hooks,signal:controller.signal,onProgress:async progress=>{status={...status,progress:Math.max(10,progress)};await this.repository.running(principal,initial.jobId,status.progress);}});
      if(controller.signal.aborted)throw new BoardFileExportFailure('CANCELLED');
      const losses:C.BoardFileExportLoss[]=[...artifact.losses];
      const objectKey=`whiteboard-exports/${principal.orgId}/${initial.jobId}.${artifact.extension}`,sha256=createHash('sha256').update(artifact.bytes).digest('hex');
      await this.objects.putOnce(objectKey,artifact.bytes,artifact.mimeType);status=C.BoardFileExportStatus.parse({...status,status:'done',progress:100,objectCount:artifact.objectCount,pageOrder:artifact.pageOrder,losses,sizeBytes:artifact.bytes.length,errorCode:null});
      await this.repository.complete(principal,status,objectKey,sha256);
    }catch(error){
      const cancelled=controller.signal.aborted||(error instanceof BoardFileExportFailure&&error.code==='CANCELLED');status=C.BoardFileExportStatus.parse({...status,status:cancelled?'cancelled':'failed',sizeBytes:null,errorCode:cancelled?null:error instanceof BoardFileExportFailure&&error.code==='BOUNDS_EXCEEDED'?'BOUNDS_EXCEEDED':'GENERATION_FAILED'});
      try{await this.repository.finish(principal,status);}catch{/* A failed metadata write never makes bytes downloadable. */}
    }finally{this.active.delete(initial.jobId);}
  }
  private validJob(jobId:string):void{if(!C.BoardFileExportStatus.shape.jobId.safeParse(jobId).success)throw new Fault('VALIDATION_FAILED');}
  async status(principal:Principal,jobId:string){this.validJob(jobId);const found=await this.repository.find(principal,jobId);if(!found)throw new Fault('NOT_FOUND');return found.status;}
  async cancel(principal:Principal,jobId:string){this.validJob(jobId);const status=await this.repository.cancel(principal,jobId);if(!status)throw new Fault('NOT_FOUND');this.active.get(jobId)?.abort();return status;}
  async content(principal:Principal,jobId:string):Promise<WhiteboardFileExportContent>{
    this.validJob(jobId);const found=await this.repository.find(principal,jobId);if(!found)throw new Fault('NOT_FOUND');if(found.status.status!=='done'||!found.objectKey||!found.sha256)throw new Fault('NOT_READY');
    try{const [head,bytes]=await Promise.all([this.objects.head(found.objectKey),this.objects.get(found.objectKey)]);if(!head||!bytes||head.sizeBytes!==found.status.sizeBytes||head.mime!==found.status.mimeType||createHash('sha256').update(bytes).digest('hex')!==found.sha256)throw new Fault('NOT_READY');return{bytes,mimeType:found.status.mimeType,filename:found.status.filename};}
    catch(error){if(error instanceof Fault)throw error;if(error instanceof ObjectStoreUnavailableError)throw new Fault('NOT_READY');throw error;}
  }
}
