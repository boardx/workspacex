import {createHash} from 'node:crypto';
import {PortableBoardBundle,PortableImportRequest,PortableImportResult,PortableExportResult} from '@repo/contracts/whiteboard-portable';
import {WHITEBOARD_IMPORT_LIMITS} from '@repo/contracts/whiteboard-import';
import {WHITEBOARD_LIMITS,WhiteboardObject,type WhiteboardCommand} from '@repo/contracts/whiteboard-document';
import {readContentObject,type CanonicalContentObject,type ImageContent} from '@repo/whiteboard-core';
import type {Principal} from '../../domain/principal';
import {assertPrincipal} from '../../domain/principal';
import type {WhiteboardRepository} from './ports';
import type {WhiteboardCollaborationStore,WhiteboardUpdateValidator} from './collaboration-ports';
import type {WhiteboardImageAssets,BoardImageVerifier,VerifiedBoardImage} from './image-assets';
import {WhiteboardImportError as Fault} from './import-service';
export const WHITEBOARD_PORTABLE_SERVICE=Symbol('WhiteboardPortableService');
export type PortableAck=ReturnType<typeof PortableImportResult.parse>;
export interface PortablePublish { publish(p:Principal,boardId:string,input:{requestId:string;expectedEpoch:number;requestHash:string;commands:WhiteboardCommand[];images:VerifiedBoardImage[]}):Promise<PortableAck>; }
export const portableHash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value));
function decode(value:string){if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Fault('INVALID_UPLOAD');return Buffer.from(value,'base64');}
function file(bytes:Uint8Array){if(!bytes.length||bytes.length>WHITEBOARD_IMPORT_LIMITS.uploadBytes)throw new Fault('PAYLOAD_TOO_LARGE');return{sizeBytes:bytes.length,sha256:portableHash(bytes),contentBase64:Buffer.from(bytes).toString('base64')};}
function mapImages(object:WhiteboardObject,map:(image:ImageContent)=>ImageContent):WhiteboardObject{
 const content=readContentObject(object);if(object.kind==='image'&&content?.type!=='image')throw new Fault('INVALID_UPLOAD');if(!content)return object;
 const visit=(item:CanonicalContentObject):CanonicalContentObject=>{
  if(item.type==='tile'&&item.coverAssetId)throw new Fault('UNSUPPORTED_FORMAT');
  if(item.type==='image')return map(item);
  if(item.type==='template')return{...item,objects:item.objects?.map(child=>({...child,content:visit(child.content) as typeof child.content}))};
  return item;
 };
 return{...object,extensionData:{...object.extensionData,contentObject:visit(content)}};
}
function imageContents(object:WhiteboardObject){const images:ImageContent[]=[];mapImages(object,image=>{images.push(image);return image;});return images;}
function validateGraph(objects:WhiteboardObject[]){
 const byId=new Map(objects.map(object=>[object.id,object]));if(byId.size!==objects.length)throw new Fault('INVALID_UPLOAD');
 const done=new Set<string>(),visiting=new Set<string>(),ordered:WhiteboardObject[]=[];
 function visit(object:WhiteboardObject){const chain:WhiteboardObject[]=[];let current:WhiteboardObject|undefined=object;while(current&&!done.has(current.id)){if(visiting.has(current.id))throw new Fault('INVALID_UPLOAD');visiting.add(current.id);chain.push(current);if(!current.parentId)break;const parent=byId.get(current.parentId);if(!parent||!['frame','group'].includes(parent.kind))throw new Fault('INVALID_UPLOAD');current=parent;}for(const item of chain.reverse()){visiting.delete(item.id);done.add(item.id);ordered.push(item);}}
 for(const object of objects){if(object.connector&&((object.connector.from&&!byId.has(object.connector.from))||(object.connector.to&&!byId.has(object.connector.to))))throw new Fault('INVALID_UPLOAD');visit(object);}
 return [...ordered.filter(object=>!object.connector),...ordered.filter(object=>object.connector)];
}
export class PortableBoardService {
 constructor(private readonly boards:WhiteboardRepository,private readonly collaboration:WhiteboardCollaborationStore,private readonly validator:WhiteboardUpdateValidator,private readonly images:WhiteboardImageAssets,private readonly verifier:BoardImageVerifier,private readonly publisher:PortablePublish){}
 private async access(p:Principal,boardId:string){assertPrincipal(p);const board=await this.boards.get(p,boardId);if(!board)throw new Fault('NOT_FOUND');if(!['owner','editor'].includes(board.role))throw new Fault('FORBIDDEN');if(board.archived)throw new Fault('ARCHIVED');}
 async export(p:Principal,boardId:string){
  await this.access(p,boardId);const state=await this.collaboration.load(p,boardId),objects=await this.validator.objects(state.update);validateGraph(objects);
  const media:ReturnType<typeof PortableBoardBundle.parse>['media']=[],seen=new Set<string>();let encodedBudget=encode(objects).length;if(encodedBudget>WHITEBOARD_IMPORT_LIMITS.uploadBytes)throw new Fault('PAYLOAD_TOO_LARGE');
  for(const image of objects.flatMap(imageContents)){if(image.status!=='ready'||!image.assetId)throw new Fault('UNSUPPORTED_FORMAT');if(seen.has(image.assetId))continue;seen.add(image.assetId);if(seen.size>WHITEBOARD_IMPORT_LIMITS.files)throw new Fault('PAYLOAD_TOO_LARGE');
   const asset=await this.images.read(p,boardId,image.assetId);encodedBudget+=4*Math.ceil(asset.bytes.length/3);if(encodedBudget>WHITEBOARD_IMPORT_LIMITS.uploadBytes)throw new Fault('PAYLOAD_TOO_LARGE');const sha256=portableHash(asset.bytes);if(asset.metadata.mimeType==='image/svg+xml')throw new Fault('UNSUPPORTED_FORMAT');media.push({path:`images/${sha256}`,assetId:image.assetId,mime:asset.metadata.mimeType,...file(asset.bytes)});
  }
  const canonical=objects.map(object=>mapImages(object,image=>({...image,sourceUrl:null})));
  const objectBytes=encode(canonical),bundle=PortableBoardBundle.parse({format:'workspacex.board.bundle.v1',revision:{epoch:state.epoch,seq:state.seq},objects:{path:'objects.json',sha256:portableHash(objectBytes),sizeBytes:objectBytes.length,content:canonical},media});
  await this.access(p,boardId);return PortableExportResult.parse({...file(encode(bundle)),fileName:`board-e${state.epoch}-s${state.seq}.board.json`,mime:'application/json'});
 }
 async import(p:Principal,boardId:string,raw:unknown){
  await this.access(p,boardId);const input=PortableImportRequest.parse(raw),bytes=decode(input.file.contentBase64);if(bytes.length!==input.file.sizeBytes||portableHash(bytes)!==input.file.sha256)throw new Fault('INTEGRITY_FAILED');
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Fault('INVALID_UPLOAD');}
  let objects:WhiteboardObject[],media:ReturnType<typeof PortableBoardBundle.parse>['media']=[];
  if(value&&typeof value==='object'&&'format' in value&&value.format==='workspacex.board.v1'){
   const legacy=value as {objects?:unknown};if(!Array.isArray(legacy.objects)||legacy.objects.length>WHITEBOARD_LIMITS.objects)throw new Fault('INVALID_UPLOAD');objects=legacy.objects.map(object=>WhiteboardObject.parse(object));if(objects.some(object=>imageContents(object).length>0))throw new Fault('UNSUPPORTED_FORMAT');
  }else{const parsed=PortableBoardBundle.safeParse(value);if(!parsed.success)throw new Fault('INVALID_UPLOAD');const bundle=parsed.data,objectBytes=encode(bundle.objects.content);if(objectBytes.length!==bundle.objects.sizeBytes||portableHash(objectBytes)!==bundle.objects.sha256)throw new Fault('INTEGRITY_FAILED');objects=bundle.objects.content;media=bundle.media;}
  if(!objects.length)throw new Fault('INVALID_UPLOAD');objects=validateGraph(objects);
  const verified:VerifiedBoardImage[]=[],assets=new Map<string,VerifiedBoardImage>(),paths=new Set<string>();let total=encode(objects).length;
  for(const entry of media){if(assets.has(entry.assetId)||paths.has(entry.path)||entry.path!==`images/${entry.sha256}`)throw new Fault('INVALID_UPLOAD');paths.add(entry.path);const imageBytes=decode(entry.contentBase64);total+=imageBytes.length;if(total>WHITEBOARD_IMPORT_LIMITS.uploadBytes)throw new Fault('PAYLOAD_TOO_LARGE');if(imageBytes.length!==entry.sizeBytes||portableHash(imageBytes)!==entry.sha256)throw new Fault('INTEGRITY_FAILED');const result=await this.verifier.verify(imageBytes,entry.mime);if(result.metadata.contentDigest!==`sha256:${entry.sha256}`)throw new Fault('INTEGRITY_FAILED');assets.set(entry.assetId,result);verified.push(result);}
  const used=new Set<string>();const ids=new Map(objects.map(object=>[object.id,`portable_${portableHash(`${input.requestId}:${object.id}`).slice(0,32)}`]));
  const commands:WhiteboardCommand[]=objects.map(original=>{
   const object=mapImages(structuredClone(original),image=>{const asset=image.assetId?assets.get(image.assetId):undefined;if(image.status!=='ready'||!asset)throw new Fault('INVALID_UPLOAD');used.add(image.assetId!);return{...image,...asset.metadata,sourceUrl:null,replacementOf:null};});
   object.id=ids.get(original.id)!;object.parentId=original.parentId?ids.get(original.parentId)!:null;if(object.connector)object.connector={...object.connector,from:object.connector.from?ids.get(object.connector.from)!:undefined,to:object.connector.to?ids.get(object.connector.to)!:undefined};delete object.restoredFrom;
   return{type:'create',object:WhiteboardObject.parse(object)};
  });
  if(used.size!==assets.size)throw new Fault('INVALID_UPLOAD');await this.access(p,boardId);
  return this.publisher.publish(p,boardId,{requestId:input.requestId,expectedEpoch:input.expectedEpoch,requestHash:portableHash(`${input.expectedEpoch}:${input.file.sha256}`),commands,images:verified});
 }
}
