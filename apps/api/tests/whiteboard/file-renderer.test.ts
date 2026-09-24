import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { createBoardFileArtifact } from '@repo/whiteboard-core';
import { NodeBoardFileRenderer } from '../../src/infrastructure/whiteboard/board-file-renderer';

const objects=(text:string):WhiteboardObject[]=>[
  {id:'frame',schemaVersion:1,kind:'frame',geometry:{x:0,y:0,width:640,height:480,rotation:0},text:'',style:{stroke:'#374151'},parentId:null,orderKey:'a'},
  {id:'note',schemaVersion:1,kind:'sticky',geometry:{x:40,y:60,width:320,height:180,rotation:0},text,style:{fill:'#fff59d',fontSize:28},parentId:'frame',orderKey:'b'},
  {id:'other',schemaVersion:1,kind:'rectangle',geometry:{x:440,y:80,width:120,height:100,rotation:0},text:'',style:{fill:'#ffffff'},parentId:'frame',orderKey:'c'},
  {id:'line',schemaVersion:1,kind:'connector',geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'',style:{stroke:'#1f2937'},parentId:'frame',orderKey:'d',connector:{from:'note',to:'other'}},
];
const request=(items:WhiteboardObject[],format:'png'|'svg'|'pdf')=>({format,background:'#ffffff',actorId:'owner',role:'owner' as const,boardName:'中文规划',objects:items});
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

describe('Node Board file renderer',()=>{
  it('embeds bundled CJK fonts in SVG and rasterizes Chinese text into a real PNG',async()=>{
    const renderer=new NodeBoardFileRenderer(),withText=objects('中文便利贴\nAlpha'),blank=objects('');
    const svgHooks=await renderer.hooks(withText,'svg'),pngHooks=await renderer.hooks(withText,'png'),svg=await createBoardFileArtifact(request(withText,'svg'),svgHooks),png=await createBoardFileArtifact(request(withText,'png'),pngHooks);
    const svgText=new TextDecoder().decode(svg.bytes);expect(svgText).toContain('中文便利贴');expect(svgText).toContain('<tspan');expect(svgText).toContain('dy="35"');expect(svgText).toContain('data:font/woff2;base64,');expect(svgText).toContain('<line data-object-id="line"');
    expect([...png.bytes.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(await sharp(png.bytes).metadata()).toMatchObject({format:'png',width:png.width,height:png.height});
    const blankHooks=await renderer.hooks(blank,'png'),blankPng=await createBoardFileArtifact(request(blank,'png'),blankHooks);expect(hash(png.bytes)).not.toBe(hash(blankPng.bytes));
  },30_000);

  it('embeds Unicode fonts in a deterministic actual PDF with Frame page order',async()=>{
    const items=[...objects('第一帧 中文'),...objects('第二帧 协作').map(object=>({...object,id:`b-${object.id}`,parentId:object.parentId?`b-${object.parentId}`:null,orderKey:`z-${object.orderKey}`,geometry:{...object.geometry,x:object.geometry.x+700},...(object.connector?{connector:{from:`b-${object.connector.from}`,to:`b-${object.connector.to}`}}:{})}))] as WhiteboardObject[];
    const renderer=new NodeBoardFileRenderer(),hooks=await renderer.hooks(items,'pdf'),first=await createBoardFileArtifact(request(items,'pdf'),hooks),second=await createBoardFileArtifact(request(items,'pdf'),hooks);
    expect(new TextDecoder().decode(first.bytes.slice(0,8))).toContain('%PDF-');expect(first.pageOrder).toEqual(['frame','b-frame']);
    expect((await PDFDocument.load(first.bytes)).getPageCount()).toBe(2);expect(hash(first.bytes)).toBe(hash(second.bytes));
    const ascii=new TextDecoder('latin1').decode(first.bytes);expect(ascii).toContain('/ToUnicode');expect(ascii).not.toContain('(????)');
  },30_000);
});
