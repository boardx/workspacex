import {
  BOARD_FILE_EXPORT_LIMITS,
  type BoardFileExportFormat,
  type BoardFileExportLoss,
} from '@repo/contracts/whiteboard-file-export';
import { WhiteboardObject, type WhiteboardObject as BoardObject } from '@repo/contracts/whiteboard-document';

export interface BoardFileExportRequest {
  readonly format: BoardFileExportFormat;
  readonly background: string;
  readonly actorId: string;
  readonly role: 'owner' | 'editor' | 'viewer';
  readonly boardName: string;
  readonly objects: readonly BoardObject[];
  /** Omissions decided by the authorized server projection, never by document extension data. */
  readonly sourceLosses?: readonly BoardFileExportLoss[];
}

export interface BoardFileArtifact {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
  readonly width: number;
  readonly height: number;
  readonly objectCount: number;
  readonly pageOrder: readonly string[];
  readonly losses: readonly BoardFileExportLoss[];
}

export interface BoardFileExportHooks {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void | Promise<void>;
  readonly now?: () => number;
  readonly maxDurationMs?: number;
  readonly fontCss?: string;
  /** Renderer-confirmed bounded substitutions for glyphs unavailable in the bundled font. */
  readonly textReplacements?: Readonly<Record<string, string>>;
  /** Object ids whose requested typeface could not be preserved and was substituted. */
  readonly fontFallbackObjectIds?: readonly string[];
  readonly renderPng?: (svg: Uint8Array, width: number, height: number, control: BoardRenderControl) => Promise<Uint8Array>;
  readonly renderPdf?: (pages: readonly BoardExportPage[], background: string, control: BoardRenderControl) => Promise<Uint8Array>;
}

export interface BoardRenderControl {
  readonly signal?: AbortSignal;
  readonly deadlineAt: number;
  checkpoint(): Promise<void>;
}

export class BoardFileExportFailure extends Error {
  constructor(readonly code: 'CANCELLED' | 'BOUNDS_EXCEEDED' | 'GENERATION_FAILED') {
    super(code); this.name = 'BoardFileExportFailure';
  }
}

export type BoardExportBounds = { x: number; y: number; width: number; height: number };
export type BoardExportPage = { id: string | null; bounds: BoardExportBounds; objects: BoardObject[] };
type Bounds = BoardExportBounds;
type LossCode = BoardFileExportLoss['code'];

const encoder = new TextEncoder();
const MAX_SAMPLE_IDS = 5;
const PNG_MAX_EDGE = 4096;
const MAX_RENDER_INPUT_BYTES = 32 * 1024 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CSV_HEADER = ['source_object_id','text','color','x','y','width','height','rotation','frame_source_id'] as const;

function safeName(name: string): string {
  return name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 180) || 'board';
}

function sortObjects(objects: readonly BoardObject[]): BoardObject[] {
  return [...objects].sort((a, b) => a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function visibleObjects(request: BoardFileExportRequest, addLoss: (code: LossCode, id: string, message: string) => void): BoardObject[] {
  // `objects` is already the server-authorized public Y.Doc projection. Never interpret
  // extensionData as ACL: any editor can author it, so doing so would make untrusted
  // document bytes decide disclosure. Private workshop state is omitted by the source port.
  const included = new Map(sortObjects(request.objects).map(object => [object.id,object]));
  return [...included.values()].filter(object => {
    if (!object.connector) return !object.parentId || included.has(object.parentId);
    if (included.has(object.connector.from) && included.has(object.connector.to)) return true;
    addLoss('HIDDEN_CONTENT_OMITTED', object.id, 'A connector to omitted content was omitted.');
    return false;
  });
}

function objectBounds(objects: readonly BoardObject[]): Bounds {
  const drawable = objects.filter(object => object.kind !== 'connector');
  if (!drawable.length) return { x: 0, y: 0, width: 1024, height: 768 };
  const left = Math.min(...drawable.map(o => o.geometry.x));
  const top = Math.min(...drawable.map(o => o.geometry.y));
  const right = Math.max(...drawable.map(o => o.geometry.x + o.geometry.width));
  const bottom = Math.max(...drawable.map(o => o.geometry.y + o.geometry.height));
  const pad = 16;
  return { x: left - pad, y: top - pad, width: Math.max(1, right - left + pad * 2), height: Math.max(1, bottom - top + pad * 2) };
}

function descendantOf(object: BoardObject, frameId: string, byId: ReadonlyMap<string, BoardObject>): boolean {
  let parent = object.parentId;
  while (parent) {
    if (parent === frameId) return true;
    parent = byId.get(parent)?.parentId ?? null;
  }
  return false;
}

function exportPages(objects: readonly BoardObject[]): BoardExportPage[] {
  const byId = new Map(objects.map(object => [object.id, object]));
  const frames = sortObjects(objects.filter(object => object.kind === 'frame'));
  if (!frames.length) return [{ id: null, bounds: objectBounds(objects), objects: [...objects] }];
  const pages: BoardExportPage[] = frames.map(frame => {
    const members = objects.filter(object => object.id === frame.id || descendantOf(object, frame.id, byId));
    const memberIds = new Set(members.map(object => object.id));
    const connectors = objects.filter(object => object.connector && memberIds.has(object.connector.from) && memberIds.has(object.connector.to));
    const { x, y, width, height } = frame.geometry;
    return { id: frame.id, bounds: { x, y, width, height }, objects: sortObjects([...members, ...connectors.filter(c => !memberIds.has(c.id))]) };
  });
  const framed = new Set(pages.flatMap(page => page.objects.map(object => object.id)));
  const unframed = objects.filter(object => !framed.has(object.id) && object.kind !== 'connector');
  if (unframed.length) {
    const ids = new Set(unframed.map(object => object.id));
    const connectors = objects.filter(object => object.connector && ids.has(object.connector.from) && ids.has(object.connector.to));
    pages.push({ id: null, bounds: objectBounds([...unframed, ...connectors]), objects: sortObjects([...unframed, ...connectors]) });
  }
  if (pages.length > BOARD_FILE_EXPORT_LIMITS.pages) throw new BoardFileExportFailure('BOUNDS_EXCEEDED');
  return pages;
}

function xml(value: string): string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function charWidth(char:string,size:number):number{return (char.codePointAt(0)??0)>0xff?size:size*.58;}
function wrappedLines(text:string,width:number,height:number,size:number):string[]{
  const lineHeight=size*1.25,maxLines=Math.max(1,Math.floor(Math.max(lineHeight,height-32)/lineHeight)),result:string[]=[];
  for(const paragraph of text.split(/\r?\n/)){
    let line='',used=0;
    for(const char of paragraph){const next=charWidth(char,size);if(line&&used+next>Math.max(size,width-32)){result.push(line);line='';used=0;if(result.length>=maxLines)return result;}line+=char;used+=next;}
    result.push(line);if(result.length>=maxLines)return result;
  }
  return result;
}

async function svgFor(objects: readonly BoardObject[], bounds: Bounds, background: BoardFileExportRequest['background'],fontCss:string,control:BoardRenderControl): Promise<Uint8Array> {
  const byId = new Map(objects.map(object => [object.id, object]));
  const body: string[] = [];
  if (background !== 'transparent') body.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${background}"/>`);
  body.push(`<defs>${fontCss?`<style>${fontCss}</style>`:''}</defs>`);
  for (const [index,object] of sortObjects(objects).entries()) {
    if(index%64===0)await control.checkpoint();
    const g=object.geometry, fill=xml(object.style.fill ?? (object.kind==='sticky'?'#fff59d':'#ffffff'));
    const stroke=xml(object.style.stroke ?? '#374151'), color=xml(object.style.color ?? '#111827');
    if (object.connector) {
      const from=byId.get(object.connector.from),to=byId.get(object.connector.to); if(!from||!to)continue;
      const x1=from.geometry.x+from.geometry.width/2,y1=from.geometry.y+from.geometry.height/2,x2=to.geometry.x+to.geometry.width/2,y2=to.geometry.y+to.geometry.height/2;
      body.push(`<line data-object-id="${xml(object.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2"/>`); continue;
    }
    const transform=g.rotation?` transform="rotate(${g.rotation} ${g.x+g.width/2} ${g.y+g.height/2})"`:'';
    body.push(`<g data-object-id="${xml(object.id)}"${transform}>`);
    if (object.kind==='ellipse') body.push(`<ellipse cx="${g.x+g.width/2}" cy="${g.y+g.height/2}" rx="${g.width/2}" ry="${g.height/2}" fill="${fill}" stroke="${stroke}"/>`);
    else body.push(`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="${object.kind==='sticky'?8:0}" fill="${['frame','group','drawing','text'].includes(object.kind)?'none':fill}" stroke="${stroke}"${['frame','group'].includes(object.kind)?' stroke-dasharray="6 4"':''}/>`);
    if (object.text) {
      const size=object.style.fontSize??16,startY=g.y+16+size,lines=wrappedLines(object.text,g.width,g.height,size);
      body.push(`<text x="${g.x+16}" y="${startY}" fill="${color}" font-family="WorkspaceX Noto Sans SC, sans-serif" font-size="${size}" xml:space="preserve">${lines.map((line,lineIndex)=>`<tspan x="${g.x+16}" dy="${lineIndex===0?0:size*1.25}">${xml(line)}</tspan>`).join('')}</text>`);
    }
    body.push('</g>');
  }
  return encoder.encode(`<svg xmlns="${SVG_NS}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}">${body.join('')}</svg>`);
}

function csvCell(value:string|number):string{const text=String(value);return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
export function stickyCsv(objects:readonly BoardObject[],addLoss?:(code:LossCode,id:string,message:string)=>void):Uint8Array{
  const rows=[CSV_HEADER.join(',')];
  for(const object of sortObjects(objects)){
    if(object.kind!=='sticky'){addLoss?.('UNSUPPORTED_OBJECT',object.id,'Only sticky notes are represented in sticky CSV.');continue;}
    const unsupported=Boolean(object.style.stroke||object.style.color||object.style.fontSize||object.geometry.rotation||object.extensionData);
    if(unsupported)addLoss?.('UNSUPPORTED_PROPERTY',object.id,'CSV keeps editable sticky fields; additional styling and extensions were omitted.');
    const g=object.geometry;rows.push([object.id,object.text,object.style.fill??'#fff59d',g.x,g.y,g.width,g.height,g.rotation,object.parentId??''].map(csvCell).join(','));
  }
  return encoder.encode(`\ufeff${rows.join('\r\n')}\r\n`);
}

function parseCsvRows(source:string):string[][]{
  const text=source.charCodeAt(0)===0xfeff?source.slice(1):source,rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i]!;if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"'&&cell==='')quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw new Error('INVALID_CSV');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>r.some(Boolean));
}

export function parseStickyCsv(source:string):{objects:BoardObject[];losses:BoardFileExportLoss[]}{
  if(encoder.encode(source).length>BOARD_FILE_EXPORT_LIMITS.bytes)throw new Error('CSV_TOO_LARGE');
  const rows=parseCsvRows(source);if(!rows.length||rows[0]!.join('\0')!==CSV_HEADER.join('\0'))throw new Error('INVALID_CSV_HEADER');
  if(rows.length-1>BOARD_FILE_EXPORT_LIMITS.objects)throw new Error('CSV_TOO_MANY_ROWS');
  const notes:BoardObject[]=[],frameIds=new Set<string>(),ids=new Set<string>();
  for(const [index,row] of rows.slice(1).entries()){
    if(row.length!==CSV_HEADER.length)throw new Error('INVALID_CSV_ROW');const [id,text,color,x,y,width,height,rotation,frameId]=row as string[];
    if(!id||ids.has(id))throw new Error('INVALID_CSV_ID');ids.add(id);if(frameId)frameIds.add(frameId);
    const object=WhiteboardObject.safeParse({id,schemaVersion:1,kind:'sticky',geometry:{x:Number(x),y:Number(y),width:Number(width),height:Number(height),rotation:Number(rotation)},text,style:{fill:color},parentId:frameId||null,orderKey:`csv-${String(index).padStart(8,'0')}`,extensionData:{sourceObjectId:id}});
    if(!object.success)throw new Error('INVALID_CSV_ROW');notes.push(object.data);
  }
  for(const frameId of frameIds)if(ids.has(frameId))throw new Error('INVALID_CSV_FRAME_ID');
  const frames:BoardObject[]=[...frameIds].sort().map((frameId,index)=>{const children=notes.filter(note=>note.parentId===frameId),bounds=objectBounds(children);return WhiteboardObject.parse({id:frameId,schemaVersion:1,kind:'frame',geometry:{...bounds,rotation:0},text:`Frame ${index+1}`,style:{},parentId:null,orderKey:`frame-${String(index).padStart(8,'0')}`,extensionData:{sourceObjectId:frameId}});});
  return{objects:[...frames,...notes],losses:[]};
}

export async function createBoardFileArtifact(request:BoardFileExportRequest,hooks:BoardFileExportHooks={}):Promise<BoardFileArtifact>{
  const started=(hooks.now??(()=>Date.now()))(),losses=new Map<LossCode,{ids:string[];message:string;count:number}>();
  const addLoss=(code:LossCode,id:string,message:string)=>{const value=losses.get(code)??{ids:[],message,count:0};value.count++;if(value.ids.length<MAX_SAMPLE_IDS&&!value.ids.includes(id))value.ids.push(id);losses.set(code,value);};
  for(const loss of request.sourceLosses??[]){const value=losses.get(loss.code)??{ids:[],message:loss.message,count:0};value.count+=loss.count;for(const id of loss.sampleObjectIds)if(value.ids.length<MAX_SAMPLE_IDS&&!value.ids.includes(id))value.ids.push(id);losses.set(loss.code,value);}
  const now=hooks.now??(()=>Date.now()),deadlineAt=started+(hooks.maxDurationMs??BOARD_FILE_EXPORT_LIMITS.durationMs);
  const renderCheckpoint=async()=>{if(hooks.signal?.aborted)throw new BoardFileExportFailure('CANCELLED');if(now()>deadlineAt)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');await new Promise<void>(resolve=>setTimeout(resolve,0));};
  const checkpoint=async(progress:number)=>{await renderCheckpoint();await hooks.onProgress?.(progress);};
  const control:BoardRenderControl={signal:hooks.signal,deadlineAt,checkpoint:renderCheckpoint};
  if(request.objects.length>BOARD_FILE_EXPORT_LIMITS.objects)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');
  const estimatedBytes=request.objects.reduce((sum,object)=>sum+encoder.encode(object.text).byteLength+512,0);if(estimatedBytes>MAX_RENDER_INPUT_BYTES)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');
  const replacements=hooks.textReplacements??{},prepared=request.objects.map(object=>replacements[object.id]===undefined?object:{...object,text:replacements[object.id]!});
  await checkpoint(20);const objects=visibleObjects({...request,objects:prepared},addLoss),bounds=objectBounds(objects),pages=exportPages(objects);await checkpoint(40);
  const fallbackIds=new Set(hooks.fontFallbackObjectIds??[]);
  for(const object of objects){if(fallbackIds.has(object.id))addLoss('FONT_FALLBACK',object.id,'The requested typeface was unavailable and a bundled Unicode font was substituted.');if(object.geometry.rotation&&request.format!=='svg')addLoss('ROTATION_APPROXIMATED',object.id,'Rotation is approximated in this export format.');if(['image','drawing','extension'].includes(object.kind))addLoss('UNSUPPORTED_OBJECT',object.id,'This object is exported as a bounded placeholder.');}
  let bytes:Uint8Array,mimeType:string,extension:string,width=Math.ceil(bounds.width),height=Math.ceil(bounds.height);
  if(request.format==='svg'){bytes=await svgFor(objects,bounds,request.background,hooks.fontCss??'',control);mimeType='image/svg+xml';extension='svg';}
  else if(request.format==='png'){
    if(!hooks.renderPng)throw new BoardFileExportFailure('GENERATION_FAILED');
    const scale=Math.min(1,PNG_MAX_EDGE/bounds.width,PNG_MAX_EDGE/bounds.height,Math.sqrt(BOARD_FILE_EXPORT_LIMITS.pixels/(bounds.width*bounds.height)));width=Math.max(1,Math.ceil(bounds.width*scale));height=Math.max(1,Math.ceil(bounds.height*scale));
    bytes=await hooks.renderPng(await svgFor(objects,bounds,request.background,hooks.fontCss??'',control),width,height,control);mimeType='image/png';extension='png';
  }
  else if(request.format==='pdf'){if(!hooks.renderPdf)throw new BoardFileExportFailure('GENERATION_FAILED');bytes=await hooks.renderPdf(pages,request.background,control);mimeType='application/pdf';extension='pdf';}
  else{bytes=stickyCsv(objects,addLoss);mimeType='text/csv; charset=utf-8';extension='csv';width=0;height=0;}
  await checkpoint(90);if(bytes.length>BOARD_FILE_EXPORT_LIMITS.bytes)throw new BoardFileExportFailure('BOUNDS_EXCEEDED');await checkpoint(100);
  return{bytes,mimeType,extension,width,height,objectCount:objects.length,pageOrder:pages.flatMap(page=>page.id?[page.id]:[]),losses:[...losses.entries()].map(([code,value])=>({code,count:value.count,sampleObjectIds:value.ids,message:value.message}))};
}

export function boardExportFilename(boardName:string,extension:string):string{return`${safeName(boardName)}.${extension}`;}
