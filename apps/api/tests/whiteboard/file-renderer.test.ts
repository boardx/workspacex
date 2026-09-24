import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { BoardFileExportFailure, createBoardFileArtifact, type BoardRenderControl } from '@repo/whiteboard-core';
import { NodeBoardFileRenderer,serializeBoardPdf } from '../../src/infrastructure/whiteboard/board-file-renderer';

const objects=(text:string):WhiteboardObject[]=>[
  {id:'frame',schemaVersion:1,kind:'frame',geometry:{x:0,y:0,width:640,height:480,rotation:0},text:'',style:{stroke:'#374151'},parentId:null,orderKey:'a'},
  {id:'note',schemaVersion:1,kind:'sticky',geometry:{x:40,y:60,width:320,height:180,rotation:0},text,style:{fill:'#fff59d',fontSize:28},parentId:'frame',orderKey:'b'},
  {id:'other',schemaVersion:1,kind:'rectangle',geometry:{x:440,y:80,width:120,height:100,rotation:0},text:'',style:{fill:'#ffffff'},parentId:'frame',orderKey:'c'},
  {id:'line',schemaVersion:1,kind:'connector',geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'',style:{stroke:'#1f2937'},parentId:'frame',orderKey:'d',connector:{from:'note',to:'other'}},
];
const request=(items:WhiteboardObject[],format:'png'|'svg'|'pdf')=>({format,background:'#ffffff',actorId:'owner',role:'owner' as const,boardName:'中文规划',objects:items});
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const control=()=>({signal:new AbortController().signal,deadlineAt:Date.now()+30_000});
function actualText(pdf:Uint8Array):string{
  const bytes=Buffer.from(pdf),sources=[bytes.toString('latin1')];
  let cursor=0;
  while((cursor=bytes.indexOf('stream\n',cursor,'latin1'))>=0){
    const start=cursor+'stream\n'.length,end=bytes.indexOf('\nendstream',start,'latin1');
    if(end<0)break;
    try{sources.push(inflateSync(bytes.subarray(start,end)).toString('latin1'));}catch{/* Fonts and other non-Flate streams are irrelevant here. */}
    cursor=end+'\nendstream'.length;
  }
  const values:string[]=[];
  for(const source of sources)for(const match of source.matchAll(/\/ActualText <([0-9A-F]+)>/g)){
    const encoded=Buffer.from(match[1]!,'hex'),little=Buffer.alloc(encoded.length);
    for(let index=0;index<encoded.length;index+=2){little[index]=encoded[index+1]!;little[index+1]=encoded[index]!;}
    values.push(little.toString('utf16le').replace(/^\ufeff/,''));
  }
  return values.join('\n');
}

describe('Node Board file renderer',()=>{
  it('embeds bundled CJK fonts in SVG and rasterizes Chinese text into a real PNG',async()=>{
    const renderer=new NodeBoardFileRenderer(),withText=objects('中文便利贴\nAlpha'),blank=objects('');
    const svgHooks=await renderer.hooks(withText,'svg',control()),pngHooks=await renderer.hooks(withText,'png',control()),svg=await createBoardFileArtifact(request(withText,'svg'),svgHooks),png=await createBoardFileArtifact(request(withText,'png'),pngHooks);
    const svgText=new TextDecoder().decode(svg.bytes);expect(svgText).toContain('中文便利贴');expect(svgText).toContain('<tspan');expect(svgText).toContain('dy="35"');expect(svgText).toContain('data:font/woff2;base64,');expect(svgText).toContain('<line data-object-id="line"');
    expect([...png.bytes.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(await sharp(png.bytes).metadata()).toMatchObject({format:'png',width:png.width,height:png.height});
    const blankHooks=await renderer.hooks(blank,'png',control()),blankPng=await createBoardFileArtifact(request(blank,'png'),blankHooks);expect(hash(png.bytes)).not.toBe(hash(blankPng.bytes));
  },30_000);

  it('embeds Unicode fonts in a deterministic actual PDF with Frame page order',async()=>{
    const items=[...objects('第一帧 中文'),...objects('第二帧 协作').map(object=>({...object,id:`b-${object.id}`,parentId:object.parentId?`b-${object.parentId}`:null,orderKey:`z-${object.orderKey}`,geometry:{...object.geometry,x:object.geometry.x+700},...(object.connector?{connector:{from:`b-${object.connector.from}`,to:`b-${object.connector.to}`}}:{})}))] as WhiteboardObject[];
    const renderer=new NodeBoardFileRenderer(),hooks=await renderer.hooks(items,'pdf',control()),first=await createBoardFileArtifact(request(items,'pdf'),hooks),second=await createBoardFileArtifact(request(items,'pdf'),hooks);
    expect(new TextDecoder().decode(first.bytes.slice(0,8))).toContain('%PDF-');expect(first.pageOrder).toEqual(['frame','b-frame']);
    expect((await PDFDocument.load(first.bytes)).getPageCount()).toBe(2);expect(hash(first.bytes)).toBe(hash(second.bytes));
    const ascii=new TextDecoder('latin1').decode(first.bytes);expect(ascii).toContain('/ToUnicode');expect(ascii).not.toContain('(????)');expect(actualText(first.bytes).replace(/\s/g,'')).toContain('第一帧中文');expect(actualText(first.bytes).replace(/\s/g,'')).toContain('第二帧协作');
  },30_000);

  it.each(['svg','png','pdf'] as const)('substitutes unsupported emoji and rare glyphs truthfully in %s',async format=>{
    const items=objects('Team 🚀 中文 \u{10ffff}'),renderer=new NodeBoardFileRenderer(),hooks=await renderer.hooks(items,format,control()),artifact=await createBoardFileArtifact(request(items,format),hooks);
    expect(artifact.losses.find(loss=>loss.code==='FONT_FALLBACK')).toMatchObject({count:1,sampleObjectIds:['note']});expect(artifact.bytes.length).toBeGreaterThan(20);
    if(format==='svg'){const svg=new TextDecoder().decode(artifact.bytes);expect(svg).not.toContain('🚀');expect(svg).not.toContain('\u{10ffff}');expect(svg).toMatch(/[□?]/);}
  },30_000);

  it('yields during a large glyph scan so cancellation covers the hooks phase',async()=>{
    const renderer=new NodeBoardFileRenderer(),large=objects('a'.repeat(2*1024*1024)),controller=new AbortController();setImmediate(()=>controller.abort());
    await expect(renderer.hooks(large,'svg',{signal:controller.signal,deadlineAt:Date.now()+30_000})).rejects.toMatchObject({code:'CANCELLED'});
  },30_000);

  it('enforces the deadline during glyph scanning and lets the event loop progress for a large valid input',async()=>{
    const renderer=new NodeBoardFileRenderer(),large=objects('a'.repeat(2*1024*1024)),deadlineSignal=new AbortController();await expect(renderer.hooks(large,'svg',{signal:deadlineSignal.signal,deadlineAt:Date.now()+2})).rejects.toMatchObject({code:'BOUNDS_EXCEEDED'});
    let yielded=false;setImmediate(()=>{yielded=true;});const hooks=await renderer.hooks(large,'svg',{signal:new AbortController().signal,deadlineAt:Date.now()+30_000});expect(yielded).toBe(true);expect(hooks.fontCss).toContain('data:font/woff2;base64,');
  },30_000);

  it('interrupts the final PDF writer on cancellation and deadline expiry',async()=>{
    const document=await PDFDocument.create();for(let index=0;index<500;index++)document.addPage([100,100]);const cancelled=new AbortController(),active=(deadlineAt:number):BoardRenderControl=>({signal:cancelled.signal,deadlineAt,assertActive(){if(cancelled.signal.aborted)throw new BoardFileExportFailure('CANCELLED');if(Date.now()>deadlineAt)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');},checkpoint:async()=>{}});
    const timer=setTimeout(()=>cancelled.abort(),0);await expect(serializeBoardPdf(document,[],active(Date.now()+30_000))).rejects.toMatchObject({code:'CANCELLED'});clearTimeout(timer);
    const expired=new AbortController(),expiredControl:BoardRenderControl={signal:expired.signal,deadlineAt:Date.now()-1,assertActive(){throw new BoardFileExportFailure('BOUNDS_EXCEEDED');},checkpoint:async()=>{}};await expect(serializeBoardPdf(await PDFDocument.create(),[],expiredControl)).rejects.toMatchObject({code:'BOUNDS_EXCEEDED'});
  });
});
