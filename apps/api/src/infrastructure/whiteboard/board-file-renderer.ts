import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { BoardFileExportFailure, type BoardExportPage, type BoardFileExportHooks, type BoardRenderControl } from '@repo/whiteboard-core';
import { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';

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
async function neededFaces(objects:readonly WhiteboardObject[],control:{signal:AbortSignal;deadlineAt:number}):Promise<{faces:FontFace[];replacements:Record<string,string>;fallbackIds:string[]}>{
  const all=await fontFaces(),selected=new Set<FontFace>(),replacements:Record<string,string>={},fallbackIds:string[]=[];
  const replacement=all.some(face=>covers(face,0x25a1))?'□':'?';
  for(const object of objects){let text='',changed=false;for(const char of object.text){const cp=char.codePointAt(0)!,face=all.find(candidate=>covers(candidate,cp));if(face){selected.add(face);text+=char;}else{text+=replacement;changed=true;const replacementFace=all.find(candidate=>covers(candidate,replacement.codePointAt(0)!));if(!replacementFace)throw new Error('Bundled replacement glyph unavailable');selected.add(replacementFace);}}if(changed){replacements[object.id]=text;fallbackIds.push(object.id);}}
  const result=[...selected];for(const face of result){if(control.signal.aborted)throw new BoardFileExportFailure('CANCELLED');if(Date.now()>control.deadlineAt)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');face.bytes??=new Uint8Array(await readFile(face.path));}
  return{faces:result,replacements,fallbackIds};
}
async function embeddedCss(faces:readonly FontFace[]):Promise<string>{return faces.map(face=>face.css.replace('__FONT__',`data:font/woff2;base64,${Buffer.from(face.bytes!).toString('base64')}`)).join('');}
function color(value:string|undefined,fallback:[number,number,number]):[number,number,number]{const match=/^#([0-9a-f]{6})$/i.exec(value??'');if(!match)return fallback;return[Number.parseInt(match[1]!.slice(0,2),16)/255,Number.parseInt(match[1]!.slice(2,4),16)/255,Number.parseInt(match[1]!.slice(4,6),16)/255];}

async function pdfBytes(pages:readonly BoardExportPage[],background:string,faces:readonly FontFace[],control:BoardRenderControl):Promise<Uint8Array>{
  const document=await PDFDocument.create();document.registerFontkit(fontkit);document.setProducer('WorkspaceX Board Export');document.setCreator('WorkspaceX');document.setCreationDate(new Date(0));document.setModificationDate(new Date(0));
  const fonts=new Map<FontFace,PDFFont>();for(const face of faces){await control.checkpoint();fonts.set(face,await document.embedFont(face.bytes!,{subset:true}));}
  const faceFor=(char:string)=>faces.find(face=>covers(face,char.codePointAt(0)!));
  for(const source of pages){const scale=Math.min(1,14400/source.bounds.width,14400/source.bounds.height),width=Math.max(1,source.bounds.width*scale),height=Math.max(1,source.bounds.height*scale),page=document.addPage([width,height]);
    if(background!=='transparent'){const [r,g,b]=color(background,[1,1,1]);page.drawRectangle({x:0,y:0,width,height,color:rgb(r,g,b)});}
    const x=(value:number)=>(value-source.bounds.x)*scale,y=(value:number)=>height-(value-source.bounds.y)*scale;const byId=new Map(source.objects.map(object=>[object.id,object]));
    for(const [index,object] of source.objects.entries()){if(index%32===0)await control.checkpoint();const g=object.geometry;
      if(object.connector){const from=byId.get(object.connector.from),to=byId.get(object.connector.to),[lr,lg,lb]=color(object.style.stroke,[.22,.25,.32]);if(from&&to)page.drawLine({start:{x:x(from.geometry.x+from.geometry.width/2),y:y(from.geometry.y+from.geometry.height/2)},end:{x:x(to.geometry.x+to.geometry.width/2),y:y(to.geometry.y+to.geometry.height/2)},thickness:2,color:rgb(lr,lg,lb)});continue;}
      const [fr,fg,fb]=color(object.style.fill,object.kind==='sticky'?[1,.96,.62]:[1,1,1]),[sr,sg,sb]=color(object.style.stroke,[.22,.25,.32]),[tr,tg,tb]=color(object.style.color,[.07,.09,.15]);const rotation=degrees(-g.rotation),options={x:x(g.x),y:y(g.y+g.height),width:g.width*scale,height:g.height*scale,borderWidth:1,borderColor:rgb(sr,sg,sb),rotate:rotation};
      if(object.kind==='ellipse')page.drawEllipse({x:x(g.x+g.width/2),y:y(g.y+g.height/2),xScale:g.width*scale/2,yScale:g.height*scale/2,color:rgb(fr,fg,fb),borderColor:rgb(sr,sg,sb),borderWidth:1,rotate:rotation});
      else page.drawRectangle(['frame','group','drawing','text'].includes(object.kind)?{...options,borderDashArray:['frame','group'].includes(object.kind)?[6,4]:undefined}:{...options,color:rgb(fr,fg,fb)});
      await drawText(page,object.text,x(g.x+16),y(g.y+16+(object.style.fontSize??16)),Math.max(8,Math.min(72,(object.style.fontSize??16)*scale)),Math.max(8,(g.width-32)*scale),Math.max(8,(g.height-32)*scale),rotation,[tr,tg,tb],faceFor,fonts,control);
    }
  }
  await control.checkpoint();
  return document.save({useObjectStreams:false,addDefaultPage:false,objectsPerTick:50});
}
async function drawText(page:PDFPage,text:string,startX:number,startY:number,size:number,maxWidth:number,maxHeight:number,rotation:ReturnType<typeof degrees>,textColor:[number,number,number],faceFor:(char:string)=>FontFace|undefined,fonts:ReadonlyMap<FontFace,PDFFont>,control:BoardRenderControl):Promise<void>{
  const maxLines=Math.max(1,Math.floor(maxHeight/(size*1.25))),lines:string[]=[];
  for(const paragraph of text.split(/\r?\n/)){let line='',width=0;for(const char of paragraph){const face=faceFor(char);if(!face)throw new Error('Missing bundled glyph');const next=fonts.get(face)!.widthOfTextAtSize(char,size);if(line&&width+next>maxWidth){lines.push(line);if(lines.length>=maxLines)break;line='';width=0;}line+=char;width+=next;}if(lines.length>=maxLines)break;lines.push(line);if(lines.length>=maxLines)break;}
  let y=startY;
  for(const line of lines){let x=startX,current:FontFace|undefined,run='';page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence,[PDFName.of('Span'),`<< /ActualText ${PDFHexString.fromText(line).toString()} >>`]));const flush=()=>{if(!run||!current)return;const font=fonts.get(current)!;page.drawText(run,{x,y,size,font,color:rgb(...textColor),rotate:rotation});x+=font.widthOfTextAtSize(run,size);run='';};for(const char of line){const face=faceFor(char);if(!face)throw new Error('Missing bundled glyph');if(face!==current){flush();current=face;}run+=char;}flush();page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));y-=size*1.25;await control.checkpoint();}
}

export class NodeBoardFileRenderer {
  async hooks(objects:readonly WhiteboardObject[],format:'png'|'svg'|'pdf'|'sticky-csv',control:{signal:AbortSignal;deadlineAt:number}):Promise<Pick<BoardFileExportHooks,'fontCss'|'fontFallbackObjectIds'|'textReplacements'|'renderPng'|'renderPdf'>>{
    if(format==='sticky-csv')return{};
    const prepared=await neededFaces(objects,control),fontCss=await embeddedCss(prepared.faces);
    return{fontCss,fontFallbackObjectIds:prepared.fallbackIds,textReplacements:prepared.replacements,renderPng:async(svg,width,height,renderControl)=>{
      await renderControl.checkpoint();const seconds=Math.max(1,Math.ceil((renderControl.deadlineAt-Date.now())/1000));const pipeline=sharp(svg,{density:144}).resize({width,height,fit:'fill'}).png({compressionLevel:9,adaptiveFiltering:false}).timeout({seconds});
      const abort=()=>pipeline.destroy(new BoardFileExportFailure('CANCELLED'));renderControl.signal?.addEventListener('abort',abort,{once:true});try{return new Uint8Array(await pipeline.toBuffer());}catch(error){if(renderControl.signal?.aborted)throw new BoardFileExportFailure('CANCELLED');throw error;}finally{renderControl.signal?.removeEventListener('abort',abort);}
    },renderPdf:(pages,background,renderControl)=>pdfBytes(pages,background,prepared.faces,renderControl)};
  }
}
