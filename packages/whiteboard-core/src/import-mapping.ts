import { WHITEBOARD_IMPORT_LIMITS } from '@repo/contracts/whiteboard-import';
import type { WhiteboardAssetMetadata } from '@repo/contracts/whiteboard-asset';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';

export type ImportSource = 'miro' | 'mural';
export interface ImportedBoardItem {
  sourceId: string; sourceType: string; type: 'sticky'|'text'|'shape'|'connector'|'image'|'panel'|'group'|'tile'|'unsupported';
  x: number; y: number; width: number; height: number; rotation: number; text: string; color: string | null;
  shape: string | null; parentSourceId: string | null; fromSourceId: string | null; toSourceId: string | null;
  zIndex: number; assetRef: string | null; metadata: Record<string, unknown>;
  assetMetadata?: WhiteboardAssetMetadata;
  losses?: string[];
  unsupportedReason?: string;
  assetMime: 'image/jpeg'|'image/png'|'image/webp'|'image/gif'|null;
}
export interface ImportMappingIssue { code: 'UNSUPPORTED_ITEM'|'INVALID_REFERENCE'|'OBJECT_LIMIT'|'ASSET_MISSING'|'VALUE_NORMALIZED'; sourceId: string|null; sourceType: string|null; detail: string; }
export interface ImportMappingOutcome { sourceId:string; sourceType:string; outcome:'success'|'downgraded'|'skipped'|'failed'; reasonCode:string|null; detail:string|null; }
export interface ImportMappingResult { commands: WhiteboardCommand[]; issues: ImportMappingIssue[]; outcomes:ImportMappingOutcome[]; discovered: number; accepted: number; unsupported: number; assets: number; }

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
function shapeVariant(value:string|null,issues:ImportMappingIssue[],item:ImportedBoardItem): 'rectangle'|'rounded-rectangle'|'circle'|'ellipse'|'diamond'|'triangle'|'hexagon'|'cloud'|'database'|'document' {
  const normalized=String(value??'rectangle').toLowerCase().replace(/[_ ]/g,'-');
  if(['rectangle','rounded-rectangle','circle','ellipse','diamond','triangle','hexagon','cloud','database','document'].includes(normalized)) return normalized as ReturnType<typeof shapeVariant>;
  issues.push({code:'VALUE_NORMALIZED',sourceId:item.sourceId,sourceType:item.sourceType,detail:`Unsupported shape ${value??item.sourceType} normalized to rectangle`});
  return 'rectangle';
}
function importedObject(id:string,item:ImportedBoardItem,source:ImportSource,parentId:string|null,issues:ImportMappingIssue[]):WhiteboardObject|null {
  const base={id,schemaVersion:1 as const,geometry:geometry(item),text:item.text.slice(0,20_000),parentId,orderKey:item.sourceId.slice(0,128),zIndex:Math.trunc(finite(item.zIndex,0,-1_000_000,1_000_000))};
  if(Object.entries(base.geometry).some(([key,value])=>value!==item[key as keyof ImportedBoardItem]))issues.push({code:'VALUE_NORMALIZED',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Geometry was normalized to canonical coordinate and size bounds.'});
  const imported=provenance(source,item);
  if(item.type==='sticky') return {...base,kind:'sticky',style:{fill:color(item.color,'#FFF4A3',issues,item),color:'#111827'},extensionData:{import:imported}};
  if(item.type==='text') return {...base,kind:'text',style:{color:color(item.color,'#111827',issues,item)},extensionData:{import:imported}};
  if(item.type==='shape') {
    const variant=shapeVariant(item.shape,issues,item),fill=color(item.color,'#FFFFFF',issues,item);
    return {...base,kind:variant==='ellipse'||variant==='circle'?'ellipse':'rectangle',style:{fill,stroke:'#1F2937'},extensionData:{import:imported,contentObject:contentShape(variant,fill)}};
  }
  if(item.type==='panel') return {...base,kind:'frame',style:{fill:color(item.color,'#FFFFFF',issues,item)},extensionData:{import:imported,spatial:{version:1,mode:'freeform',autoExpand:true,clipContent:false,padding:24,gap:24,columns:3,flowDirection:'horizontal'}}};
  if(item.type==='group') return {...base,kind:'group',style:{},extensionData:{import:imported}};
  if(item.type==='tile') return {...base,kind:'extension',style:{fill:color(item.color,'#FFFFFF',issues,item)},extensionData:{import:imported,contentObject:{version:1,type:'tile',tileType:'data',title:item.text.slice(0,300)||'Imported item',description:'',icon:null,coverAssetId:null,fields:[],tags:[],link:null,status:null,actions:[]}}};
  if(item.type==='image') {
    if(!item.assetRef || !item.assetMetadata){issues.push({code:'ASSET_MISSING',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Image has no verified asset'});return null;}
    return {...base,kind:'image',style:{},extensionData:{import:imported,contentObject:{version:1,type:'image',status:'ready',...item.assetMetadata,sourceUrl:null,crop:{x:0,y:0,width:1,height:1},opacity:1,borderColor:'#000000',borderWidth:0,cornerRadius:0,fileName:(item.sourceId==='.'||item.sourceId==='..'?'Imported image':item.sourceId).replace(/[/\\\x00-\x1f]/g,'_').slice(0,255)||'Imported image',replacementOf:null,failureCode:null}}};
  }
  return null;
}

/** Pure importer: produces canonical commands; it never touches Fabric or Yjs directly. */
export function mapImportedBoard(source:ImportSource, requestId:string, input:readonly ImportedBoardItem[], limit:number=WHITEBOARD_IMPORT_LIMITS.objects):ImportMappingResult {
  const issues:ImportMappingIssue[]=[], commands:WhiteboardCommand[]=[], selected=input.slice(0,limit);
  if(input.length>limit) return {commands:[],issues:[{code:'OBJECT_LIMIT',sourceId:null,sourceType:null,detail:`Import rejected: ${input.length} objects exceed the atomic limit of ${limit}; no objects were imported. Split the source board before retrying.`}],outcomes:[],discovered:input.length,accepted:0,unsupported:input.length,assets:0};
  for(const item of selected) for(const detail of item.type==='unsupported'?[]:item.losses??[]) issues.push({code:'VALUE_NORMALIZED',sourceId:item.sourceId,sourceType:item.sourceType,detail});
  const seenSourceIds=new Set<string>(),duplicates=new Set<ImportedBoardItem>();
  for(const item of selected){if(seenSourceIds.has(item.sourceId)){duplicates.add(item);issues.push({code:'INVALID_REFERENCE',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Duplicate source id was skipped'});}else seenSourceIds.add(item.sourceId);}
  const emitted=new Map<string,{id:string;kind:WhiteboardObject['kind'];object:WhiteboardObject;item:ImportedBoardItem}>();
  for(const [index,item] of selected.entries()){
    if(duplicates.has(item))continue;
    if(item.type==='unsupported'){issues.push({code:'UNSUPPORTED_ITEM',sourceId:item.sourceId,sourceType:item.sourceType,detail:item.unsupportedReason??`${item.sourceType} is not supported`});continue;}
    if(item.type==='connector') continue;
    const id=`import_${requestId.replace(/-/g,'').slice(0,12)}_${index}`,object=importedObject(id,item,source,null,issues);
    if(object)emitted.set(item.sourceId,{id,kind:object.kind,object,item});
  }
  for(const value of emitted.values()){
    const parent=value.item.parentSourceId?emitted.get(value.item.parentSourceId):undefined;
    if(value.item.parentSourceId&&(!parent||!['frame','group'].includes(parent.kind)))issues.push({code:'INVALID_REFERENCE',sourceId:value.item.sourceId,sourceType:value.item.sourceType,detail:`Parent ${value.item.parentSourceId} is not an emitted panel`});
    commands.push({type:'create',object:{...value.object,parentId:parent&&['frame','group'].includes(parent.kind)?parent.id:null}});
  }
  for(const item of selected.filter(value=>value.type==='connector'&&!duplicates.has(value))){
    const from=item.fromSourceId?emitted.get(item.fromSourceId)?.id:undefined,to=item.toSourceId?emitted.get(item.toSourceId)?.id:undefined;
    if(!from||!to){issues.push({code:'INVALID_REFERENCE',sourceId:item.sourceId,sourceType:item.sourceType,detail:'Connector endpoint was not imported'});continue;}
    const id=`import_${requestId.replace(/-/g,'').slice(0,12)}_${selected.indexOf(item)}`;
    commands.push({type:'create',object:{id,schemaVersion:1,kind:'connector',geometry:geometry(item),text:item.text.slice(0,1000),style:{stroke:color(item.color,'#1F2937',issues,item)},parentId:null,orderKey:item.sourceId.slice(0,128),zIndex:Math.trunc(item.zIndex),connector:{from,to,type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:item.text.slice(0,1000),semanticRelation:typeof item.metadata.semanticRelation==='string'?item.metadata.semanticRelation.slice(0,256):undefined},extensionData:{import:provenance(source,item)}}});
  }
  const acceptedIds=new Set(commands.flatMap(command=>command.type==='create'&&command.object.extensionData?.import&&typeof command.object.extensionData.import==='object'&&'sourceId' in command.object.extensionData.import?[String(command.object.extensionData.import.sourceId)]:[]));
  const outcomes=selected.map(item=>{const itemIssues=issues.filter(issue=>issue.sourceId===item.sourceId),first=duplicates.has(item)?itemIssues.find(issue=>issue.code==='INVALID_REFERENCE'):itemIssues.find(issue=>issue.code!=='VALUE_NORMALIZED')??itemIssues[0];if(!duplicates.has(item)&&acceptedIds.has(item.sourceId)){const downgraded=itemIssues.length>0;return{sourceId:item.sourceId,sourceType:item.sourceType,outcome:downgraded?'downgraded' as const:'success' as const,reasonCode:downgraded?first?.code??'VALUE_NORMALIZED':null,detail:downgraded?first?.detail??null:null};}const skipped=item.type==='unsupported'||duplicates.has(item);return{sourceId:item.sourceId,sourceType:item.sourceType,outcome:skipped?'skipped' as const:'failed' as const,reasonCode:first?.code??'NOT_EMITTED',detail:first?.detail??'Source item could not be imported'};});
  return {commands,issues,outcomes,discovered:input.length,accepted:commands.length,unsupported:input.length-commands.length,assets:selected.filter(item=>item.type==='image'&&item.assetRef).length};
}
