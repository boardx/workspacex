import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { BoardFileExportFailure, createBoardFileArtifact, parseStickyCsv, stickyCsv } from '../src/file-export';

const geometry=(x:number,y:number,width=180,height=120)=>({x,y,width,height,rotation:0});
const fixtures=JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/file-export-golden.json',import.meta.url)),'utf8')) as Array<{name:string;frames:number;notesPerFrame:number;hiddenNotes:number;expected:{width:number;height:number;objectCount:number;pageCount:number;hiddenLoss:number}}>;
function board(frames:number,notesPerFrame:number,hiddenNotes=0):WhiteboardObject[]{
  const objects:WhiteboardObject[]=[];let hidden=0;
  for(let f=0;f<frames;f++){
    const frameId=`frame-${String(f).padStart(2,'0')}`;objects.push({id:frameId,schemaVersion:1,kind:'frame',geometry:geometry(f*900,0,800,600),text:`Frame ${f}`,style:{stroke:'#374151'},parentId:null,orderKey:`f-${String(f).padStart(2,'0')}`});
    for(let n=0;n<notesPerFrame;n++){
      const id=`note-${f}-${n}`,isHidden=hidden<hiddenNotes&&n===0;if(isHidden)hidden++;
      objects.push({id,schemaVersion:1,kind:'sticky',geometry:geometry(f*900+20+(n%4)*190,50+Math.floor(n/4)*140),text:`Idea ${f},${n}\nnext`,style:{fill:'#fff59d'},parentId:frameId,orderKey:`n-${String(n).padStart(2,'0')}`,...(isHidden?{extensionData:{visibility:'hidden'}}:{})});
    }
  }
  return objects;
}
const request=(objects:readonly WhiteboardObject[],format:'png'|'svg'|'pdf'|'sticky-csv',extra:Partial<{actorId:string;role:'owner'|'editor'|'viewer';background:string}>={})=>({format,background:extra.background??'#ffffff',actorId:extra.actorId??'owner',role:extra.role??'owner',boardName:'Planning',objects});

describe('Board file export encoders',()=>{
  it.each(fixtures)('matches the $name golden dimensions, counts, pages and loss report',async fixture=>{
    const artifact=await createBoardFileArtifact(request(board(fixture.frames,fixture.notesPerFrame,fixture.hiddenNotes),'svg'));
    expect({width:artifact.width,height:artifact.height,objectCount:artifact.objectCount,pageCount:artifact.pageOrder.length}).toEqual({width:fixture.expected.width,height:fixture.expected.height,objectCount:fixture.expected.objectCount,pageCount:fixture.expected.pageCount});
    expect(artifact.pageOrder).toEqual(Array.from({length:fixture.frames},(_,i)=>`frame-${String(i).padStart(2,'0')}`));
    expect(artifact.losses.find(loss=>loss.code==='HIDDEN_CONTENT_OMITTED')?.count??0).toBe(fixture.expected.hiddenLoss);
    expect(new TextDecoder().decode(artifact.bytes)).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });

  it('creates a standalone SVG and preserves deterministic Frame order',async()=>{
    const objects=board(2,2);
    const svg=await createBoardFileArtifact(request(objects,'svg'));expect(new TextDecoder().decode(svg.bytes)).toContain('data-object-id="note-0-0"');
    expect(svg.pageOrder).toEqual(['frame-00','frame-01']);
  });

  it('round-trips sticky text, color, geometry, frame and source object identity through CSV',()=>{
    const source=board(1,1),note=source.find(object=>object.kind==='sticky')!;note.geometry.rotation=12;note.style.fill='#12abef';note.text='comma, quote " and\nnewline';
    const csv=new TextDecoder().decode(stickyCsv(source));expect(csv).toContain('source_object_id,text,color,x,y,width,height,rotation,frame_source_id');
    const parsed=parseStickyCsv(csv),copy=parsed.objects.find(object=>object.kind==='sticky')!;
    expect(copy).toMatchObject({id:note.id,text:note.text,style:{fill:'#12abef'},geometry:note.geometry,parentId:'frame-00',extensionData:{sourceObjectId:note.id}});
    expect(parsed.objects.find(object=>object.kind==='frame')?.id).toBe('frame-00');
  });

  it('does not let untrusted extensionData become an authorization boundary',async()=>{
    const objects=board(1,1);objects.push({id:'mine',schemaVersion:1,kind:'sticky',geometry:geometry(10,300),text:'mine',style:{},parentId:'frame-00',orderKey:'z1',extensionData:{visibility:'private',ownerId:'owner'}},{id:'theirs',schemaVersion:1,kind:'sticky',geometry:geometry(210,300),text:'secret marker',style:{},parentId:'frame-00',orderKey:'z2',extensionData:{visibility:'private',ownerId:'other'}});
    const artifact=await createBoardFileArtifact(request(objects,'svg',{actorId:'owner',role:'owner'})),text=new TextDecoder().decode(artifact.bytes);
    expect(text).toContain('mine');expect(text).toContain('secret marker');expect(artifact.losses.find(loss=>loss.code==='PRIVATE_CONTENT_OMITTED')).toBeUndefined();
  });

  it('reports font fallback only for renderer-confirmed object ids',async()=>{
    const objects=board(1,2),artifact=await createBoardFileArtifact(request(objects,'svg'),{fontFallbackObjectIds:['note-0-1']});
    expect(artifact.losses.find(loss=>loss.code==='FONT_FALLBACK')).toMatchObject({count:1,sampleObjectIds:['note-0-1']});
  });

  it('honors cancellation and duration bounds',async()=>{
    const cancelled=new AbortController();cancelled.abort();await expect(createBoardFileArtifact(request(board(1,1),'png'),{signal:cancelled.signal})).rejects.toEqual(expect.objectContaining({code:'CANCELLED'}));
    let now=0;await expect(createBoardFileArtifact(request(board(1,1),'svg'),{now:()=>now+=31_000,maxDurationMs:30_000})).rejects.toBeInstanceOf(BoardFileExportFailure);
  });
});
