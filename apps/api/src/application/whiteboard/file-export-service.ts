import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as W, whiteboardFileExport as C } from '@repo/contracts';
import { BoardFileExportFailure, assertBoardFileExportPreflight, boardExportFilename, createBoardFileArtifact } from '@repo/whiteboard-core';
import { ObjectExistsError, ObjectStoreUnavailableError, type ObjectStore } from '../artifact/ports';
import type { Principal } from '../../domain/principal';
import { WhiteboardFileExportError as Fault, type WhiteboardFileExportCleaner, type WhiteboardFileExportContent, type WhiteboardFileExportRepository, type WhiteboardFileExportService, type WhiteboardFileExportSource, type WhiteboardFileRenderer } from './file-export-ports';

const MIME:Record<C.BoardFileExportFormat,string>={png:'image/png',svg:'image/svg+xml',pdf:'application/pdf','sticky-csv':'text/csv; charset=utf-8'};
const EXTENSION:Record<C.BoardFileExportFormat,string>={png:'png',svg:'svg',pdf:'pdf','sticky-csv':'csv'};

const LEASE_MS=30_000,GLOBAL_CONCURRENCY=2,CANCEL_POLL_MS=100;

/** Durable PostgreSQL claims are job truth; any process may recover an expired lease. */
export class DefaultWhiteboardFileExportService implements WhiteboardFileExportService {
  constructor(private readonly source:WhiteboardFileExportSource,private readonly repository:WhiteboardFileExportRepository,
    private readonly objects:ObjectStore,private readonly renderer:WhiteboardFileRenderer,private readonly cleaner:WhiteboardFileExportCleaner){}

  async create(principal:Principal,boardId:string,raw:C.BoardFileExportInput):Promise<C.BoardFileExportStatus>{
    if(!W.BoardId.safeParse(boardId).success)throw new Fault('VALIDATION_FAILED');const parsed=C.BoardFileExportInput.safeParse(raw);if(!parsed.success)throw new Fault('VALIDATION_FAILED');
    const snapshot=await this.source.load(principal,boardId),jobId=randomUUID(),extension=EXTENSION[parsed.data.format];
    const status=C.BoardFileExportStatus.parse({jobId,boardId,format:parsed.data.format,status:'queued',progress:0,filename:boardExportFilename(snapshot.boardName,extension),mimeType:MIME[parsed.data.format],objectCount:0,pageOrder:[],losses:[],sizeBytes:null,errorCode:null});
    await this.repository.create(principal,status,parsed.data);return status;
  }
  async runNext(workerId:string):Promise<boolean>{const claim=await this.repository.claimNext(workerId,LEASE_MS,GLOBAL_CONCURRENCY);if(!claim)return false;const {principal,input}=claim,controller=new AbortController(),deadlineAt=Date.now()+C.BOARD_FILE_EXPORT_LIMITS.durationMs;let status:C.BoardFileExportStatus={...claim.status,status:'running',progress:10},polling=false;
    const deadline=setTimeout(()=>controller.abort(new BoardFileExportFailure('BOUNDS_EXCEEDED')),C.BOARD_FILE_EXPORT_LIMITS.durationMs);deadline.unref();
    const cancellation=setInterval(()=>{if(polling||controller.signal.aborted)return;polling=true;void this.repository.renew(claim,status.progress,LEASE_MS).then(active=>{if(!active)controller.abort(new BoardFileExportFailure('CANCELLED'));}).catch(()=>controller.abort(new BoardFileExportFailure('CANCELLED'))).finally(()=>{polling=false;});},CANCEL_POLL_MS);cancellation.unref();
    try{
      const snapshot=await this.source.load(principal,status.boardId);assertBoardFileExportPreflight(snapshot.objects);
      const hooks=input.format==='sticky-csv'?{}:await this.renderer.hooks(snapshot.objects,input.format,{signal:controller.signal,deadlineAt});
      const artifact=await createBoardFileArtifact({...input,actorId:principal.userId,role:snapshot.role,boardName:snapshot.boardName,objects:snapshot.objects,sourceLosses:snapshot.losses},{...hooks,signal:controller.signal,maxDurationMs:C.BOARD_FILE_EXPORT_LIMITS.durationMs,onProgress:async progress=>{status={...status,progress:Math.max(10,progress)};if(!await this.repository.renew(claim,status.progress,LEASE_MS)){controller.abort();throw new BoardFileExportFailure('CANCELLED');}}});
      if(controller.signal.aborted)throw new BoardFileExportFailure('CANCELLED');
      const losses:C.BoardFileExportLoss[]=[...artifact.losses];
      const sha256=createHash('sha256').update(artifact.bytes).digest('hex');
      try{await this.objects.putOnce(claim.objectKey,artifact.bytes,artifact.mimeType);}catch(error){if(!(error instanceof ObjectExistsError))throw error;}
      const [publishedHead,publishedBytes]=await Promise.all([this.objects.head(claim.objectKey),this.objects.get(claim.objectKey)]);
      if(!publishedHead||!publishedBytes||publishedHead.sizeBytes!==artifact.bytes.length||publishedHead.mime!==artifact.mimeType||createHash('sha256').update(publishedBytes).digest('hex')!==sha256)throw new BoardFileExportFailure('GENERATION_FAILED');
      status=C.BoardFileExportStatus.parse({...status,status:'done',progress:100,objectCount:artifact.objectCount,pageOrder:artifact.pageOrder,losses,sizeBytes:artifact.bytes.length,errorCode:null});
      if(!await this.repository.complete(claim,status,sha256))throw new BoardFileExportFailure('CANCELLED');
    }catch(error){
      const reason=controller.signal.reason,timedOut=reason instanceof BoardFileExportFailure&&reason.code==='BOUNDS_EXCEEDED',cancelled=!timedOut&&(controller.signal.aborted||(error instanceof BoardFileExportFailure&&error.code==='CANCELLED'));status=C.BoardFileExportStatus.parse({...status,status:cancelled?'cancelled':'failed',sizeBytes:null,errorCode:cancelled?null:timedOut||error instanceof BoardFileExportFailure&&error.code==='BOUNDS_EXCEEDED'?'BOUNDS_EXCEEDED':'GENERATION_FAILED'});
      try{await this.repository.finish(claim,status);}catch{/* The durable lease is recovered after expiry. */}
    }finally{clearTimeout(deadline);clearInterval(cancellation);}return true;
  }
  async cleanupNext(workerId:string):Promise<boolean>{const cleanup=await this.repository.claimCleanup(workerId);if(!cleanup)return false;let deleted=false;try{deleted=await this.cleaner.purge(cleanup.objectKey);}finally{await this.repository.finishCleanup(cleanup,deleted);}return true;}
  private validJob(jobId:string):void{if(!C.BoardFileExportStatus.shape.jobId.safeParse(jobId).success)throw new Fault('VALIDATION_FAILED');}
  async status(principal:Principal,jobId:string){this.validJob(jobId);const found=await this.repository.find(principal,jobId);if(!found)throw new Fault('NOT_FOUND');return found.status;}
  async cancel(principal:Principal,jobId:string){this.validJob(jobId);const status=await this.repository.cancel(principal,jobId);if(!status)throw new Fault('NOT_FOUND');return status;}
  async content(principal:Principal,jobId:string):Promise<WhiteboardFileExportContent>{
    this.validJob(jobId);const found=await this.repository.find(principal,jobId);if(!found)throw new Fault('NOT_FOUND');if(found.status.status!=='done'||!found.objectKey||!found.sha256)throw new Fault('NOT_READY');
    try{const [head,bytes]=await Promise.all([this.objects.head(found.objectKey),this.objects.get(found.objectKey)]);if(!head||!bytes||head.sizeBytes!==found.status.sizeBytes||head.mime!==found.status.mimeType||createHash('sha256').update(bytes).digest('hex')!==found.sha256)throw new Fault('NOT_READY');return{bytes,mimeType:found.status.mimeType,filename:found.status.filename};}
    catch(error){if(error instanceof Fault)throw error;if(error instanceof ObjectStoreUnavailableError)throw new Fault('NOT_READY');throw error;}
  }
}
