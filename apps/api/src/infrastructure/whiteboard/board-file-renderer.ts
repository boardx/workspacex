import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { BoardExportPage, BoardFileExportHooks } from '@repo/whiteboard-core';

type FontFace={path:string;ranges:readonly [number,number][];css:string;bytes?:Uint8Array};
const require=createRequire(import.meta.url);
let cachedFaces:Promise<FontFace[]>|undefined;

function ranges(value:string):readonly [number,number][]{return value.split(',').map(item=>{const [from,to]=item.trim().replace(/^U\+/i,'').split('-');const start=Number.parseInt(from!,16);return[start,to?Number.parseInt(to,16):start] as [number,number];});}
async function fontFaces():Promise<FontFace[]>{
  cachedFaces??=(async()=>{const cssPath=require.resolve('@fontsource-variable/noto-sans-sc'),base=dirname(cssPath),css=await readFile(cssPath,'utf8'),faces:FontFace[]=[];
    for(const match of css.matchAll(/@font-face\s*{([\s\S]*?)}/g)){const body=match[1]!,url=/url\(([^)]+)\)/.exec(body)?.[1]?.replace(/["']/g,''),unicode=/unicode-range:\s*([^;]+);/.exec(body)?.[1];if(!url||!unicode)continue;faces.push({path:resolve(base,url),ranges:ranges(unicode),css:`@font-face{font-family:'WorkspaceX Noto Sans SC';font-style:normal;font-weight:100 900;src:url(__FONT__) format('woff2');unicode-range:${unicode};}`});}
    if(!faces.length)throw new Error('Noto Sans SC font assets unavailable');return faces;})();return cachedFaces;
}
const covers=(face:FontFace,cp:number)=>face.ranges.some(([from,to])=>cp>=from&&cp<=to);
async function neededFaces(objects:readonly WhiteboardObject[]):Promise<FontFace[]>{
  const all=await fontFaces(),codepoints=new Set([...objects.flatMap(object=>[...object.text])].map(char=>char.codePointAt(0)!));const selected=new Set<FontFace>();
  for(const cp of codepoints){const face=all.find(candidate=>covers(candidate,cp));if(!face)throw new Error(`Bundled font has no glyph for U+${cp.toString(16)}`);selected.add(face);}
  const result=[...selected];await Promise.all(result.map(async face=>{face.bytes??=new Uint8Array(await readFile(face.path));}));return result;
}
async function embeddedCss(faces:readonly FontFace[]):Promise<string>{return faces.map(face=>face.css.replace('__FONT__',`data:font/woff2;base64,${Buffer.from(face.bytes!).toString('base64')}`)).join('');}
function color(value:string|undefined,fallback:[number,number,number]):[number,number,number]{const match=/^#([0-9a-f]{6})$/i.exec(value??'');if(!match)return fallback;return[Number.parseInt(match[1]!.slice(0,2),16)/255,Number.parseInt(match[1]!.slice(2,4),16)/255,Number.parseInt(match[1]!.slice(4,6),16)/255];}

async function pdfBytes(pages:readonly BoardExportPage[],background:string,faces:readonly FontFace[]):Promise<Uint8Array>{
  const document=await PDFDocument.create();document.registerFontkit(fontkit);document.setProducer('WorkspaceX Board Export');document.setCreator('WorkspaceX');document.setCreationDate(new Date(0));document.setModificationDate(new Date(0));
  const fonts=new Map<FontFace,PDFFont>();for(const face of faces)fonts.set(face,await document.embedFont(face.bytes!,{subset:true}));
  const faceFor=(char:string)=>faces.find(face=>covers(face,char.codePointAt(0)!));
  for(const source of pages){const scale=Math.min(1,14400/source.bounds.width,14400/source.bounds.height),width=Math.max(1,source.bounds.width*scale),height=Math.max(1,source.bounds.height*scale),page=document.addPage([width,height]);
    if(background!=='transparent'){const [r,g,b]=color(background,[1,1,1]);page.drawRectangle({x:0,y:0,width,height,color:rgb(r,g,b)});}
    const x=(value:number)=>(value-source.bounds.x)*scale,y=(value:number)=>height-(value-source.bounds.y)*scale;const byId=new Map(source.objects.map(object=>[object.id,object]));
    for(const object of source.objects){const g=object.geometry;
      if(object.connector){const from=byId.get(object.connector.from),to=byId.get(object.connector.to);if(from&&to)page.drawLine({start:{x:x(from.geometry.x+from.geometry.width/2),y:y(from.geometry.y+from.geometry.height/2)},end:{x:x(to.geometry.x+to.geometry.width/2),y:y(to.geometry.y+to.geometry.height/2)},thickness:2,color:rgb(.22,.25,.32)});continue;}
      const [fr,fg,fb]=color(object.style.fill,object.kind==='sticky'?[1,.96,.62]:[1,1,1]);const options={x:x(g.x),y:y(g.y+g.height),width:g.width*scale,height:g.height*scale,borderWidth:1,borderColor:rgb(.22,.25,.32)};
      if(object.kind==='ellipse')page.drawEllipse({x:x(g.x+g.width/2),y:y(g.y+g.height/2),xScale:g.width*scale/2,yScale:g.height*scale/2,color:rgb(fr,fg,fb),borderColor:rgb(.22,.25,.32),borderWidth:1});
      else page.drawRectangle(object.kind==='frame'?options:{...options,color:rgb(fr,fg,fb)});
      drawText(page,object.text,x(g.x+8),y(g.y+24),Math.max(8,Math.min(72,(object.style.fontSize??16)*scale)),faceFor,fonts);
    }
  }
  return document.save({useObjectStreams:false,addDefaultPage:false,objectsPerTick:50});
}
function drawText(page:PDFPage,text:string,startX:number,startY:number,size:number,faceFor:(char:string)=>FontFace|undefined,fonts:ReadonlyMap<FontFace,PDFFont>):void{
  let y=startY;
  for(const line of text.split(/\r?\n/)){let x=startX,current:FontFace|undefined,run='';const flush=()=>{if(!run||!current)return;const font=fonts.get(current)!;page.drawText(run,{x,y,size,font,color:rgb(.07,.09,.15)});x+=font.widthOfTextAtSize(run,size);run='';};
    for(const char of line){const face=faceFor(char);if(!face)throw new Error('Missing bundled glyph');if(face!==current){flush();current=face;}run+=char;}flush();y-=size*1.25;
  }
}

export class NodeBoardFileRenderer {
  async hooks(objects:readonly WhiteboardObject[],format:'png'|'svg'|'pdf'|'sticky-csv'):Promise<Pick<BoardFileExportHooks,'fontCss'|'renderPng'|'renderPdf'>>{
    if(format==='sticky-csv')return{};
    const faces=await neededFaces(objects),fontCss=await embeddedCss(faces);
    return{fontCss,renderPng:async(svg,width,height)=>new Uint8Array(await sharp(svg,{density:144}).resize({width,height,fit:'fill'}).png({compressionLevel:9,adaptiveFiltering:false}).toBuffer()),renderPdf:(pages,background)=>pdfBytes(pages,background,faces)};
  }
}
