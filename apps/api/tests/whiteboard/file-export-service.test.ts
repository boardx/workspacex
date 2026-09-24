import { describe,expect,it } from 'vitest';
import type { whiteboardFileExport as C } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { toOrgId } from '../../src/domain/org-id';
import { DefaultWhiteboardFileExportService } from '../../src/application/whiteboard/file-export-service';
import type { WhiteboardFileExportRecord,WhiteboardFileExportRepository,WhiteboardFileExportSource,WhiteboardFileRenderer } from '../../src/application/whiteboard/file-export-ports';
import { FakeObjectStore } from '../support/artifact-fakes';

const principal={orgId:toOrgId('org-a'),userId:'owner'},other={orgId:toOrgId('org-b'),userId:'owner'};
const boardId='57d83843-21e2-40ae-8c1c-571d0ad63c80';
const note:WhiteboardObject={id:'note',schemaVersion:1,kind:'sticky',geometry:{x:1,y:2,width:200,height:120,rotation:0},text:'中文,idea',style:{fill:'#fff59d'},parentId:null,orderKey:'a'};
class MemoryRepository implements WhiteboardFileExportRepository{
  readonly values=new Map<string,{owner:string;record:WhiteboardFileExportRecord}>();readonly audit:string[]=[];readonly trace:string[]=[];readonly revoked=new Set<string>();
  async create(p:typeof principal,status:C.BoardFileExportStatus){this.values.set(status.jobId,{owner:`${p.orgId}/${p.userId}`,record:{status,objectKey:null,sha256:null}});}
  private own(p:typeof principal,id:string){const value=this.values.get(id);return value?.owner===`${p.orgId}/${p.userId}`&&!this.revoked.has(id)?value:null;}
  async running(p:typeof principal,id:string,progress:number){const value=this.own(p,id);if(!value||!['queued','running'].includes(value.record.status.status))throw new Error('not runnable');value.record={...value.record,status:{...value.record.status,status:'running',progress:Math.max(value.record.status.progress,progress)}};this.trace.push(`running:${progress}`);}
  async complete(p:typeof principal,status:C.BoardFileExportStatus,key:string,sha:string){const value=this.own(p,status.jobId);if(!value)throw new Error();value.record={status,objectKey:key,sha256:sha};this.audit.push('done');this.trace.push('done');}
  async finish(p:typeof principal,status:C.BoardFileExportStatus){const value=this.own(p,status.jobId);if(value&&['queued','running'].includes(value.record.status.status)){value.record={...value.record,status};this.audit.push(status.status);}}
  async find(p:typeof principal,id:string){return this.own(p,id)?.record??null;}
  async cancel(p:typeof principal,id:string){const value=this.own(p,id);if(!value)return null;if(['queued','running'].includes(value.record.status.status)){value.record={...value.record,status:{...value.record.status,status:'cancelled'}};this.audit.push('cancelled');this.trace.push('cancelled');}return value.record.status;}
}
const source:WhiteboardFileExportSource={load:async()=>({boardName:'规划',role:'owner',objects:[note]})};
const renderer:WhiteboardFileRenderer={hooks:async()=>({})};

describe('durable Board export jobs',()=>{
  it('reads completed metadata and immutable bytes after service reconstruction',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[];
    const first=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,task=>tasks.push(task));
    const queued=await first.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});expect(queued.status).toBe('queued');await tasks.shift()!();
    const second=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,task=>tasks.push(task)),done=await second.status(principal,queued.jobId);expect(done).toMatchObject({status:'done',objectCount:1});
    const content=await second.content(principal,queued.jobId);expect(new TextDecoder().decode(content.bytes)).toContain('中文,idea');expect(content.mimeType).toContain('text/csv');expect(repository.audit).toEqual(['done']);
    await expect(second.status(other,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('exports sticky CSV with unsupported emoji without loading visual fonts',async()=>{
    const emojiNote={...note,text:'Team 🚀 🧠 idea'},emojiSource:WhiteboardFileExportSource={load:async()=>({boardName:'Emoji',role:'editor',objects:[emojiNote]})};
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[],fontRenderer:WhiteboardFileRenderer={hooks:async()=>{throw new Error('visual font renderer must not run for CSV');}};
    const service=new DefaultWhiteboardFileExportService(emojiSource,repository,objects,fontRenderer,task=>tasks.push(task));
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await tasks.shift()!();
    const content=await service.content(principal,queued.jobId);expect(new TextDecoder().decode(content.bytes)).toContain('Team 🚀 🧠 idea');
  });
  it('persists cancellation before queued work starts and never publishes bytes',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[],service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,task=>tasks.push(task));
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});expect((await service.cancel(principal,queued.jobId)).status).toBe('cancelled');await tasks.shift()!();expect((await service.status(principal,queued.jobId)).status).toBe('cancelled');await expect(service.content(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_READY'});expect(repository.audit).toEqual(['cancelled']);
  });
  it('awaits durable progress writes and lets cancellation win while rendering',async()=>{
    let releaseRender!:()=>void,markRenderStarted!:()=>void;
    const renderStarted=new Promise<void>(resolve=>{markRenderStarted=resolve;}),renderGate=new Promise<void>(resolve=>{releaseRender=resolve;});
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[];
    const blockingRenderer:WhiteboardFileRenderer={hooks:async()=>({renderPdf:async()=>{markRenderStarted();await renderGate;return new TextEncoder().encode('%PDF-1.7');}})};
    const service=new DefaultWhiteboardFileExportService(source,repository,objects,blockingRenderer,task=>tasks.push(task));
    const queued=await service.create(principal,boardId,{format:'pdf',background:'#ffffff'}),run=tasks.shift()!();
    await renderStarted;
    expect(repository.trace).toEqual(['running:10','running:20','running:40']);
    expect((await service.cancel(principal,queued.jobId)).status).toBe('cancelled');releaseRender();await run;
    expect(repository.trace).toEqual(['running:10','running:20','running:40','cancelled']);
    expect(repository.audit).toEqual(['cancelled']);
    expect((await service.status(principal,queued.jobId)).status).toBe('cancelled');
  });
  it('denies status, cancellation and completed content after Board access is revoked',async()=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[],service=new DefaultWhiteboardFileExportService(source,repository,objects,renderer,task=>tasks.push(task));
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await tasks.shift()!();repository.revoked.add(queued.jobId);
    await expect(service.status(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.cancel(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.content(principal,queued.jobId)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it.each(['owner','editor','viewer'] as const)('allows a current %s to export the public Board projection',async role=>{
    const repository=new MemoryRepository(),objects=new FakeObjectStore(),tasks:Array<()=>Promise<void>>=[],roleSource:WhiteboardFileExportSource={load:async()=>({boardName:'Planning',role,objects:[note]})},service=new DefaultWhiteboardFileExportService(roleSource,repository,objects,renderer,task=>tasks.push(task));
    const queued=await service.create(principal,boardId,{format:'sticky-csv',background:'#ffffff'});await tasks.shift()!();expect((await service.status(principal,queued.jobId)).status).toBe('done');
  });
});
