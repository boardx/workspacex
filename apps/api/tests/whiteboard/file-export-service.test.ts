import { describe,expect,it } from 'vitest';
import type { whiteboardFileExport as C } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { toOrgId } from '../../src/domain/org-id';
import { DefaultWhiteboardFileExportService } from '../../src/application/whiteboard/file-export-service';
import type { WhiteboardFileExportClaim,WhiteboardFileExportCleanup,WhiteboardFileExportRecord,WhiteboardFileExportRepository,WhiteboardFileExportSource,WhiteboardFileRenderer } from '../../src/application/whiteboard/file-export-ports';
import { FakeObjectStore } from '../support/artifact-fakes';

const principal={orgId:toOrgId('org-a'),userId:'owner'},other={orgId:toOrgId('org-b'),userId:'owner'};
const boardId='57d83843-21e2-40ae-8c1c-571d0ad63c80';
const note:WhiteboardObject={id:'note',schemaVersion:1,kind:'sticky',geometry:{x:1,y:2,width:200,height:120,rotation:0},text:'中文,idea',style:{fill:'#fff59d'},parentId:null,orderKey:'a'};
class MemoryRepository implements WhiteboardFileExportRepository{
  readonly values=new Map<string,{owner:string;principal:typeof principal;input:C.BoardFileExportInput;record:WhiteboardFileExportRecord}>();readonly audit:string[]=[];readonly trace:string[]=[];readonly revoked=new Set<string>();readonly cleanup=new Set<string>();readonly cleaned=new Set<string>();cancelOnComplete=false;
  async create(p:typeof principal,status:C.BoardFileExportStatus,input:C.BoardFileExportInput){this.values.set(status.jobId,{owner:`${p.orgId}/${p.userId}`,principal:p,input,record:{status,objectKey:`whiteboard-exports/${p.orgId}/${status.jobId}.${status.format}`,sha256:null}});}
  private own(p:typeof principal,id:string){const value=this.values.get(id);return value?.owner===`${p.orgId}/${p.userId}`&&!this.revoked.has(id)?value:null;}
  async claimNext(workerId:string){const value=[...this.values.values()].find(item=>['queued','running'].includes(item.record.status.status));if(!value)return null;value.record={...value.record,status:{...value.record.status,status:'running',progress:10}};this.trace.push('claimed');return{principal:value.principal,input:value.input,status:value.record.status,objectKey:value.record.objectKey!,leaseOwner:workerId};}
  async renew(claim:WhiteboardFileExportClaim,progress:number){const value=this.own(claim.principal,claim.status.jobId);if(!value||value.record.status.status!=='running')return false;value.record={...value.record,status:{...value.record.status,progress:Math.max(value.record.status.progress,progress)}};this.trace.push(`running:${progress}`);return true;}
  async complete(claim:WhiteboardFileExportClaim,status:C.BoardFileExportStatus,sha:string){const value=this.own(claim.principal,status.jobId);if(!value||value.record.status.status!=='running')return false;if(this.cancelOnComplete){value.record={...value.record,status:{...value.record.status,status:'cancelled'}};this.audit.push('cancelled');this.cleanup.add(status.jobId);return false;}value.record={status,objectKey:claim.objectKey,sha256:sha};this.audit.push('done');this.trace.push('done');return true;}
  async finish(claim:WhiteboardFileExportClaim,status:C.BoardFileExportStatus){const value=this.values.get(claim.status.jobId);if(value&&value.record.status.status==='running'){value.record={...value.record,status};this.audit.push(status.status);this.cleanup.add(status.jobId);}}
  async find(p:typeof principal,id:string){return this.own(p,id)?.record??null;}
  async cancel(p:typeof principal,id:string){const value=this.own(p,id);if(!value)return null;if(['queued','running'].includes(value.record.status.status)){value.record={...value.record,status:{...value.record.status,status:'cancelled'}};this.audit.push('cancelled');this.trace.push('cancelled');this.cleanup.add(id);}return value.record.status;}
  async claimCleanup(workerId:string):Promise<WhiteboardFileExportCleanup|null>{const id=this.cleanup.values().next().value as string|undefined;if(!id)return null;this.cleanup.delete(id);return{jobId:id,objectKey:this.values.get(id)!.record.objectKey!,cleanupOwner:workerId};}
  async finishCleanup(cleanup:WhiteboardFileExportCleanup,deleted:boolean):Promise<void>{if(deleted)this.cleaned.add(cleanup.jobId);else this.cleanup.add(cleanup.jobId);}
}
const source:WhiteboardFileExportSource={load:async()=>({boardName:'规划',role:'owner',objects:[note]})};
const renderer:WhiteboardFileRenderer={hooks:async()=>({})};
const cleaner={purge:async()=>true};

describe('durable Board export jobs',()=>{
  it('reads completed metadata and immutable bytes after service reconstruction',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore();
    const first=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner);
    const queued=await first.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});expect(queued.status).toBe('queued');
    const second=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner);await second.runNext('restarted-worker');const done=await second.status(principal,queued.jobId);expect(done).toMatchObject({status:'done',objectCount:1});
    const content=await second.content(principal,queued.jobId);expect(new TextDecoder().decode(content.bytes)).toContain('中文,idea');expect(content.mimeType).toContain('text/csv');expect(repository.audit).toEqual(['done']);
    await expect(second.status(other,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('exports sticky CSV with unsupported emoji without loading visual fonts',async()=>{
    const emojiNote={...note,text:'Team 🚀 🧠 idea'},emojiSource:WhiteboardFileExportSource={load:async()=>({boardName:'Emoji',role:'editor',objects:[emojiNote]})};
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),fontRenderer:WhiteboardFileRenderer={hooks:async()=>{throw new Error('visual font renderer must not run for CSV');}};
    const service=new DefaultWhiteboardFileExportService(emojiSource,repository,objects,fontRenderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');
    const content=await service.content(principal,queued.jobId);expect(new TextDecoder().decode(content.bytes)).toContain('Team 🚀 🧠 idea');
  });
  it('persists cancellation before queued work starts and never publishes bytes',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});expect((await service.cancel(principal,queued.jobId)).status).toBe('cancelled');expect(await service.runNext('worker')).toBe(false);expect((await service.status(principal,queued.jobId)).status).toBe('cancelled');await expect(service.content(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_READY'});expect(repository.audit).toEqual(['cancelled']);
  });
  it('awaits durable progress writes and lets cancellation win while rendering',async()=>{
    let releaseRender!:()=>void,markRenderStarted!:()=>void;
    const renderStarted=new Promise<void>(resolve=>{markRenderStarted=resolve;}),renderGate=new Promise<void>(resolve=>{releaseRender=resolve;});
    const repository=new MemoryRepository(),objects=new FakeObjectStore();
    const blockingRenderer:WhiteboardFileRenderer={hooks:async()=>({renderPdf:async()=>{markRenderStarted();await renderGate;return new TextEncoder().encode('%PDF-1.7');}})};
    const service=new DefaultWhiteboardFileExportService(source,repository,objects,blockingRenderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'pdf',background:'#ffffff'}),run=service.runNext('worker');
    await renderStarted;
    expect(repository.trace).toEqual(['claimed','running:20','running:40']);
    expect((await service.cancel(principal,queued.jobId)).status).toBe('cancelled');releaseRender();await run;
    expect(repository.trace).toEqual(['claimed','running:20','running:40','cancelled']);
    expect(repository.audit).toEqual(['cancelled']);
    expect((await service.status(principal,queued.jobId)).status).toBe('cancelled');
  });
  it('propagates cross-instance cancellation into the active renderer signal',async()=>{
    let observedAbort=false,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    const aborting:WhiteboardFileRenderer={hooks:async(_objects,_format,setup)=>({renderPdf:async(_pages,_background,render)=>{started();await new Promise<void>((_resolve,reject)=>render.signal?.addEventListener('abort',()=>{observedAbort=true;reject(new Error('aborted'));},{once:true}));return new Uint8Array();},signal:setup.signal})};
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),worker=new DefaultWhiteboardFileExportService(source,repository,objects,aborting,cleaner),otherInstance=new DefaultWhiteboardFileExportService(source,repository,objects,aborting,cleaner);
    const queued=await worker.create(principal,boardId,{format:'pdf',background:'#ffffff'}),run=worker.runNext('worker-a');await began;await otherInstance.cancel(principal,queued.jobId);await run;expect(observedAbort).toBe(true);expect((await worker.status(principal,queued.jobId)).status).toBe('cancelled');
  });
  it('records and purges bytes when cancellation wins after immutable publication',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),purged:string[]=[];repository.cancelOnComplete=true;const service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,{purge:async key=>{purged.push(key);return true;}});
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');expect(objects.putCount).toBe(1);expect((await service.status(principal,queued.jobId)).status).toBe('cancelled');expect(await service.cleanupNext('cleaner')).toBe(true);expect(purged).toEqual([expect.stringContaining(queued.jobId)]);expect(repository.cleaned).toContain(queued.jobId);
  });
  it.each(['size','mime','hash'] as const)('verifies a fresh immutable publication and schedules corrupt %s bytes for cleanup',async corruption=>{
    const repository=new MemoryRepository(),stored=new FakeObjectStore(),objects={putOnce:stored.putOnce.bind(stored),head:async(key:string)=>{const head=await stored.head(key);return !head?null:corruption==='size'?{...head,sizeBytes:head.sizeBytes+1}:corruption==='mime'?{...head,mime:'application/x-corrupt'}:head;},get:async(key:string)=>{const bytes=await stored.get(key);return bytes&&corruption==='hash'?new Uint8Array([...bytes.slice(0,-1),bytes.at(-1)!^1]):bytes;}},service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');expect((await service.status(principal,queued.jobId)).status).toBe('failed');expect(repository.audit).toEqual(['failed']);expect(repository.cleanup).toContain(queued.jobId);
  });
  it.each(['size','mime','hash'] as const)('rejects completed content with a corrupt %s',async corruption=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner),queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');
    const corrupt={putOnce:objects.putOnce.bind(objects),head:async(key:string)=>{const head=await objects.head(key);return !head?null:corruption==='size'?{...head,sizeBytes:head.sizeBytes+1}:corruption==='mime'?{...head,mime:'application/x-corrupt'}:head;},get:async(key:string)=>{const bytes=await objects.get(key);return bytes&&corruption==='hash'?new Uint8Array([...bytes.slice(0,-1),bytes.at(-1)!^1]):bytes;}};
    const reader=new DefaultWhiteboardFileExportService(source,repository,corrupt,renderer,cleaner);await expect(reader.content(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_READY'});
  });
  it('denies status, cancellation and completed content after Board access is revoked',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');repository.revoked.add(queued.jobId);
    await expect(service.status(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.cancel(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.content(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it.each(['owner','editor','viewer'] as const)('allows a current %s to export the public Board projection',async role=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),roleSource:WhiteboardFileExportSource={load:async()=>({boardName:'Planning',role,objects:[note]})},service=new DefaultWhiteboardFileExportService(roleSource,repository,objects,renderer,cleaner);
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await service.runNext('worker');expect((await service.status(principal,queued.jobId)).status).toBe('done');
  });
});
