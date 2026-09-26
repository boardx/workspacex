import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';

export type ImportSource = 'miro' | 'mural';
export interface ImportedBoardItem {
  sourceId: string; sourceType: string; type: 'sticky'|'text'|'shape'|'connector'|'image'|'panel'|'tile'|'unsupported';
  x: number; y: number; width: number; height: number; rotation: number; text: string; color: string | null;
  shape: string | null; parentSourceId: string | null; fromSourceId: string | null; toSourceId: string | null;
  zIndex: number; assetRef: string | null; metadata: Record<string, unknown>;
  assetMime: 'image/jpeg'|'image/png'|'image/webp'|'image/gif'|null;
}
export interface ImportMappingIssue { code: 'UNSUPPORTED_ITEM'|'INVALID_REFERENCE'|'OBJECT_LIMIT'|'ASSET_MISSING'|'VALUE_NORMALIZED'; sourceId: string|null; sourceType: string|null; detail: string; }
export interface ImportMappingResult { commands: WhiteboardCommand[]; issues: ImportMappingIssue[]; discovered: number; accepted: number; unsupported: number; assets: number; }

const finite=(value:number,fallback:number,min=-1_000_000,max=1_000_000)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const positive=(value:number,fallback:number)=>finite(value,fallback,1,100_000);
const color=(value:string|null,fallback:string,issues:ImportMappingIssue[],item:ImportedBoardItem)=>{
  if(value && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if(value) issues.push({code:'VALUE_NORMALIZED',sourceId:item.sourceId,sourceType:item.sourceType,detail:`Unsupported color ${value} normalized to ${fallback}`});
  return fallback;
};
const geometry=(item:ImportedBoardItem)=>({x:finite(item.x,0),y:finite(item.y,0),width:positive(item.width,200),height:positive(item.height,120),rotation:finite(item.rotation,0,-360,360)});
const provenance=(source:ImportSource,item:ImportedBoardItem)=>({version:1,source,sourceId:item.sourceId,sourceType:item.sourceType,metadata:item.metadata});
const contentShape=(variant:string,fill:string)=>({version:1,type:'shape',variant,fill,borderColor:'#1F2937',borderWidth:2,borderStyle:'solid',opacity:1,radius:variant==='rounded-rectangle'?16:0,textColor:'#111827',horizontalAlign:'center',verticalAlign:'middle'});
function shapeVariant(value:string|null): 'rectangle'|'rounded-rectangle'|'circle'|'ellipse'|'diamond'|'triangle'|'hexagon'|'cloud'|'database'|'document' {
  const normalized=String(value??'rectangle').toLowerCase().replace(/[_ ]/g,'-');
  if(['rectangle','rounded-rectangle','circle','ellipse','diamond','triangle','hexagon','cloud','database','document'].includes(normalized)) return normalized as ReturnType<typeof shapeVariant>;
  return 'rectangle';
}
function importedObject(id:string,item:ImportedBoardItem,source:ImportSource,parentId:string|null,issues:ImportMappingIssue[]):WhiteboardObject|null {
  const base={id,schemaVersion:1 as const,geometry:geometry(item),text:item.text.slice(0,20_000),parentId,orderKey:item.sourceId.slice(0,128),zIndex:Math.trunc(finite(item.zIndex,0,-1_000_000,1_000_000))};
  const imported=provenance(source,item);
  if(item.type==='sticky') return {...base,kind:'sticky',style:{fill:color(item.color,'#FFF4A3',issues,item),color:'#111827'},extensionData:{import:imported}};
  if(item.type==='text') return {...base,kind:'text',style:{color:color(item.color,'#111827',issues,item)},extensionData:{import:imported}};
  if(item.type==='shape') {
    const variant=shapeVariant(item.shape),fill=color(item.color,'#FFFFFF',issues,item);
    return {...base,kind:variant==='ellipse'||variant==='circle'?'ellipse':'rectangle',style:{fill,stroke:'#1F2937'},extensionData:{import:imported,contentObject:contentShape(variant,fill)}};
  }
  if(item.type==='panel') return {...base,kind:'frame',style:{fill:color(item.color,'#FFFFFF',issues,item)},extensionData:{import:imported,spatial:{version:1,mode:'freeform',autoExpand:true,clipContent:false,padding:24,gap:24,columns:3,flowDirection:'horizontal'}}};
  if(item.type==='tile') return {...base,kind:'extension',style:{fill:color(item.color,'#FFFFFF',issues,item)},extensionData:{import:imported,contentObject:{version:1,type:'tile',tileType:'data',title:item.text.slice(0,300)||'Imported item',description:'',icon:null,coverAssetId:null,fields:[],tags:[],link:null,status:null,actions:[]}}};
  if(item.type==='image') {
    if(!item.assetRef){issues.push({code:'ASSET_MISSING',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Image has no verified asset'});return null;}
    return {...base,kind:'image',style:{},extensionData:{import:imported,contentObject:{version:1,type:'image',status:'ready',assetId:item.assetRef,sourceUrl:null,mimeType:item.assetMime??'image/png',intrinsicWidth:Math.max(1,Math.round(base.geometry.width)),intrinsicHeight:Math.max(1,Math.round(base.geometry.height)),crop:{x:0,y:0,width:1,height:1},opacity:1,borderColor:'#000000',borderWidth:0,cornerRadius:0,fileName:item.sourceId,replacementOf:null,failureCode:null}}};
  }
  return null;
}

/** Pure importer: produces canonical commands; it never touches Fabric or Yjs directly. */
export function mapImportedBoard(source:ImportSource, requestId:string, input:readonly ImportedBoardItem[], limit=200):ImportMappingResult {
  const issues:ImportMappingIssue[]=[], commands:WhiteboardCommand[]=[], selected=input.slice(0,limit);
  if(input.length>limit) issues.push({code:'OBJECT_LIMIT',sourceId:null,sourceType:null,detail:`Only the first ${limit} source items can be imported atomically`});
  const ids=new Map<string,string>();
  selected.forEach((item,index)=>{if(!ids.has(item.sourceId)&&item.type!=='unsupported'&&item.type!=='connector')ids.set(item.sourceId,`import_${requestId.replace(/-/g,'').slice(0,12)}_${index}`)});
  const emitted=new Set<string>();
  for(const item of selected){
    if(item.type==='unsupported'){issues.push({code:'UNSUPPORTED_ITEM',sourceId:item.sourceId,sourceType:item.sourceType,detail:`${item.sourceType} is not supported`});continue;}
    if(item.type==='connector') continue;
    const id=ids.get(item.sourceId); if(!id) continue;
    if(emitted.has(item.sourceId)){issues.push({code:'INVALID_REFERENCE',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Duplicate source id was skipped'});continue;} emitted.add(item.sourceId);
    const parentId=item.parentSourceId?ids.get(item.parentSourceId)??null:null;
    if(item.parentSourceId&&!parentId)issues.push({code:'INVALID_REFERENCE',sourceId:item.sourceId,sourceType:item.sourceType,detail:`Parent ${item.parentSourceId} was not imported`});
    const object=importedObject(id,item,source,parentId,issues); if(object)commands.push({type:'create',object});
  }
  for(const item of selected.filter(value=>value.type==='connector')){
    const from=item.fromSourceId?ids.get(item.fromSourceId):undefined,to=item.toSourceId?ids.get(item.toSourceId):undefined;
    if(!from||!to){issues.push({code:'INVALID_REFERENCE',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Connector endpoint was not imported'});continue;}
    const id=`import_${requestId.replace(/-/g,'').slice(0,12)}_${selected.indexOf(item)}`;
    commands.push({type:'create',object:{id,schemaVersion:1,kind:'connector',geometry:geometry(item),text:item.text.slice(0,1000),style:{stroke:color(item.color,'#1F2937',issues,item)},parentId:null,orderKey:item.sourceId.slice(0,128),zIndex:Math.trunc(item.zIndex),connector:{from,to,type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:item.text.slice(0,1000),semanticRelation:typeof item.metadata.semanticRelation==='string'?item.metadata.semanticRelation.slice(0,256):undefined},extensionData:{import:provenance(source,item)}}});
  }
  return {commands,issues,discovered:input.length,accepted:commands.length,unsupported:input.length-commands.length,assets:selected.filter(item=>item.type==='image'&&item.assetRef).length};
}
