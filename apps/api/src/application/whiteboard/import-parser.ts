import JSZip from 'jszip';
import { WHITEBOARD_IMPORT_LIMITS as L, type WhiteboardImportSource } from '@repo/contracts/whiteboard-import';
import type { ImportedBoardItem } from '@repo/whiteboard-core';

export class UnsafeWhiteboardImport extends Error { constructor(readonly code:'UNSUPPORTED_FORMAT'|'UNSAFE_ARCHIVE'|'PAYLOAD_TOO_LARGE') { super(code); } }
export interface ParsedImportAsset { path:string; bytes:Uint8Array; mime:'image/jpeg'|'image/png'|'image/webp'|'image/gif'; }
export interface ParsedWhiteboardImport { items:ImportedBoardItem[]; assets:ParsedImportAsset[]; skipped:string[]; }
type R=Record<string,unknown>;
const record=(value:unknown):R=>value&&typeof value==='object'&&!Array.isArray(value)?value as R:{};
const str=(...values:unknown[])=>String(values.find(value=>typeof value==='string'||typeof value==='number')??'');
const num=(fallback:number,...values:unknown[])=>{const value=values.find(value=>typeof value==='number'||(typeof value==='string'&&value.trim()!==''));const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};
const nullable=(...values:unknown[])=>{const value=str(...values);return value?value:null;};
const safeMetadata=(value:R):R=>Object.fromEntries(Object.entries(value).filter(([key,entry])=>['semanticRelation','tags','status'].includes(key)&&(typeof entry==='string'||(Array.isArray(entry)&&entry.every(v=>typeof v==='string')))).slice(0,20));
function typeOf(raw:string):ImportedBoardItem['type']{
  const value=raw.toLowerCase().replace(/[ _-]/g,'');
  if(['sticky','stickynote','sticker','note'].includes(value))return'sticky';
  if(['text','textbox','title'].includes(value))return'text';
  if(['shape','rectangle','circle','ellipse','diamond','triangle','hexagon'].includes(value))return'shape';
  if(['connector','arrow','line'].includes(value))return'connector';
  if(['image','picture'].includes(value))return'image';
  if(['frame','area','panel','section'].includes(value))return'panel';
  if(['card','tile'].includes(value))return'tile';
  return'unsupported';
}
function normalize(raw:unknown,index:number,source:WhiteboardImportSource):ImportedBoardItem{
  const value=record(raw),position=record(value.position),geometry=record(value.geometry),size=record(value.size),style=record(value.style),content=record(value.content);
  const sourceType=str(value.type,value.kind,value.widgetType)||'unknown';
  const start=record(value.startWidget),end=record(value.endWidget),from=record(value.connectedFrom),to=record(value.connectedTo);
  return {sourceId:str(value.id,value.widgetId,`${source}-${index}`).slice(0,256),sourceType:sourceType.slice(0,128),type:typeOf(sourceType),
    x:num(0,value.x,position.x,geometry.x),y:num(0,value.y,position.y,geometry.y),width:num(200,value.width,size.width,geometry.width),height:num(120,value.height,size.height,geometry.height),rotation:num(0,value.rotation,geometry.rotation),
    text:str(value.text,value.title,content.text,content.plainText).slice(0,20_000),color:nullable(value.color,value.backgroundColor,style.backgroundColor,style.fillColor),shape:nullable(value.shape,value.shapeType,style.shape),
    parentSourceId:nullable(value.parentId,record(value.parent).id),fromSourceId:nullable(value.fromId,value.startId,start.id,from.id),toSourceId:nullable(value.toId,value.endId,end.id,to.id),
    zIndex:Math.trunc(num(index,value.zIndex,value.order)),assetRef:nullable(value.assetPath,value.imagePath,value.fileName,record(value.asset).path),assetMime:null,metadata:safeMetadata({...record(value.metadata),semanticRelation:value.semanticRelation}),};
}
function parseJson(bytes:Uint8Array,source:WhiteboardImportSource):ImportedBoardItem[]{
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');}
  const root=record(body),candidate=source==='miro'?(root.widgets??root.items??root.objects):(root.items??root.widgets??root.objects);
  if(!Array.isArray(candidate))throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  return candidate.map((value,index)=>normalize(value,index,source));
}
function csvRows(text:string):string[][]{
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i]!;if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;
}
function parseCsv(bytes:Uint8Array,source:WhiteboardImportSource):ImportedBoardItem[]{
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');}
  const rows=csvRows(text);if(rows.length<2)throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const header=rows[0]!.map(value=>value.trim()), objects=rows.slice(1).filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(header.map((key,index)=>[key,row[index]??''])));
  return objects.map((value,index)=>normalize(value,index,source));
}
function safePath(path:string):boolean{return path.length>0&&path.length<=512&&!path.includes('\\')&&!path.includes('\0')&&!path.startsWith('/')&&!/^[a-z]:/i.test(path)&&path.split('/').length<=L.pathDepth&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');}
function imageMime(bytes:Uint8Array):ParsedImportAsset['mime']|null{
  const hex=Buffer.from(bytes.subarray(0,12)).toString('hex');
  if(hex.startsWith('89504e470d0a1a0a'))return'image/png';if(hex.startsWith('ffd8ff'))return'image/jpeg';if(hex.startsWith('474946383761')||hex.startsWith('474946383961'))return'image/gif';
  if(bytes.length>=12&&new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP')return'image/webp';return null;
}
async function parseZip(bytes:Uint8Array,source:WhiteboardImportSource):Promise<ParsedWhiteboardImport>{
  let zip:JSZip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:true,createFolders:false});}catch{throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');}
  const files=Object.values(zip.files).filter(file=>!file.dir);if(files.length>L.files)throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  let expanded=0;for(const file of files){const internals=file as unknown as {unsafeOriginalName?:string;unixPermissions?:number;_data?:{uncompressedSize?:number;compressedSize?:number}};if(!safePath(file.name)||!safePath(internals.unsafeOriginalName??file.name)||(typeof internals.unixPermissions==='number'&&(internals.unixPermissions&0o170000)===0o120000))throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');const data=internals._data;const size=data?.uncompressedSize??0,compressed=data?.compressedSize??0;if(size>L.entryBytes||expanded+size>L.expandedBytes||(size>0&&compressed===0)||(compressed>0&&size/compressed>L.compressionRatio))throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');expanded+=size;}
  const document=files.find(file=>/\.(json|csv)$/i.test(file.name));if(!document)throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const documentBytes=await document.async('uint8array');const items=document.name.toLowerCase().endsWith('.csv')?parseCsv(documentBytes,source):parseJson(documentBytes,source);
  const assets:ParsedImportAsset[]=[],skipped:string[]=[];
  for(const file of files.filter(file=>file!==document)){const data=await file.async('uint8array');const mime=imageMime(data);if(mime)assets.push({path:file.name,bytes:data,mime});else skipped.push(file.name);}
  const byPath=new Map(assets.map(asset=>[asset.path,asset]));for(const item of items)if(item.assetRef){const asset=byPath.get(item.assetRef);item.assetRef=asset?.path??null;item.assetMime=asset?.mime??null;}
  return{items,assets,skipped};
}
export async function parseWhiteboardImport(bytes:Uint8Array,mime:'application/json'|'text/csv'|'application/zip',source:WhiteboardImportSource):Promise<ParsedWhiteboardImport>{
  if(bytes.byteLength<1||bytes.byteLength>L.uploadBytes)throw new UnsafeWhiteboardImport('PAYLOAD_TOO_LARGE');
  if(mime==='application/zip'){if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');return parseZip(bytes,source);}
  if(bytes.some(value=>value===0))throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const items=mime==='application/json'?parseJson(bytes,source):parseCsv(bytes,source);
  // Standalone JSON/CSV cannot authenticate companion files. URLs and local paths stay
  // provenance only and never become a canonical asset ref.
  for(const item of items)if(item.assetRef){item.assetRef=null;item.assetMime=null;}
  return{items,assets:[],skipped:[]};
}
