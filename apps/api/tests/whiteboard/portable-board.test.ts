import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it} from 'vitest';
import sharp from 'sharp';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands,readObjects} from '@repo/whiteboard-core';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {PortableBoardService,portableHash} from '../../src/application/whiteboard/portable-board';
import {WhiteboardImageAssets} from '../../src/application/whiteboard/image-assets';
import type {WhiteboardCollaborationStore,WhiteboardUpdateValidator} from '../../src/application/whiteboard/collaboration-ports';
import type {WhiteboardRepository} from '../../src/application/whiteboard/ports';
import type {DatabasePort,TenantSession} from '../../src/application/ports/database.port';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {SharpBoardImageVerifier} from '../../src/infrastructure/whiteboard/image-verifier';
import {PgPortableBoard} from '../../src/infrastructure/whiteboard/pg-portable-board';
import {PgBoardImageAssets} from '../../src/infrastructure/whiteboard/pg-image-assets';
import {toOrgId} from '../../src/domain/org-id';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const base=(id:string):WhiteboardObject=>({id,schemaVersion:1,kind:'sticky',text:'中文 + English',style:{fill:'#FFF4A3'},parentId:null,orderKey:id,geometry:{x:10,y:20,width:180,height:120,rotation:17}});
async function fixture(templateOnly=false,includeShape=false){
 const root=await mkdtemp(join(tmpdir(),'portable-board-'));roots.push(root);const objects=new FsObjectStore(root),verifier=new SharpBoardImageVerifier(),source=randomUUID(),target=randomUUID();
 const p={orgId:toOrgId('source-tenant'),userId:'owner'},targetP={orgId:toOrgId('target-tenant'),userId:'target-owner'};
 const png=await sharp({create:{width:64,height:48,channels:4,background:'#ff3300'}}).png().toBuffer(),asset=await verifier.verify(png,'image/png');
 const image:WhiteboardObject={...base('image'),kind:'image',text:'',extensionData:{contentObject:{version:1,type:'image',status:'ready',...asset.metadata,sourceUrl:null,crop:{x:.1,y:.2,width:.7,height:.6},opacity:.8,borderColor:'#112233',borderWidth:2,cornerRadius:6,fileName:'real.png',replacementOf:null,failureCode:null}}};
 const sourceDoc=createWhiteboardDocument();executeCommands(sourceDoc,[{type:'create',object:{...base('frame'),kind:'frame'}},{type:'create',object:{...base('note'),parentId:'frame',locked:true}},{type:'create',object:image},{type:'create',object:{...base('edge'),kind:'connector',connector:{from:'note',to:'image',type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:'connect'}}}],{});
 if(includeShape)executeCommands(sourceDoc,[{type:'create',object:{...base('diamond'),kind:'rectangle',extensionData:{contentObject:{version:1,type:'shape',variant:'diamond',fill:'#ffffff',borderColor:'#000000',borderWidth:1,borderStyle:'solid',opacity:1,radius:0,textColor:'#000000',horizontalAlign:'center',verticalAlign:'middle'}}}}],{});
 if(templateOnly){executeCommands(sourceDoc,[{type:'delete',id:'image'},{type:'create',object:{...base('template'),kind:'extension',text:'Reusable image',extensionData:{contentObject:{version:1,type:'template',templateId:'fixture',name:'Reusable image',versionId:'v1',parameters:{},objects:[{localId:'photo',geometry:image.geometry,content:image.extensionData!.contentObject}]}}}}],{});}
 let targetDoc=createWhiteboardDocument(),seq=0,fail=false,allowed=true,revokeAtLock=false;const queries:string[]=[];const receipts=new Map<string,any>(),publishedAssets:any[]=[];
 const sourceKey=`whiteboards/tenants/${portableHash(p.orgId).slice(0,32)}/boards/${source}/assets/${asset.metadata.contentDigest.slice(7)}`;await objects.putOnce(sourceKey,png,'image/png');
 const boards={get:async(principal:typeof p,id:string)=>allowed&&((id===source&&principal.orgId===p.orgId)||(id===target&&principal.orgId===targetP.orgId))?{id,role:'owner',archived:false}:null} as unknown as WhiteboardRepository;
 const session:TenantSession={async query<R>(sql:string,values:readonly unknown[]=[]){let rows:unknown[]=[];queries.push(sql);
  if(sql.startsWith('SELECT owner_id'))rows=allowed?[{owner_id:revokeAtLock?'different-owner':targetP.userId,archived:false}]:[];
  else if(sql.startsWith('SELECT role'))rows=revokeAtLock?[]:[{role:'editor'}];
  else if(sql.startsWith('SELECT request_hash'))rows=receipts.has(String(values[3]))?[receipts.get(String(values[3]))]:[];
  else if(sql.startsWith('INSERT INTO whiteboard_portable_imports'))receipts.set(String(values[3]),{request_hash:values[4],epoch:values[5],seq:String(values[6]),object_count:values[7],asset_count:values[8]});
  else if(sql.startsWith('INSERT INTO whiteboard_asset_refs'))publishedAssets.push({key:values[2]});
  else if(sql.startsWith('INSERT INTO whiteboard_image_assets'))publishedAssets.push({key:values[3],metadata:JSON.parse(String(values[4]))});
  else throw new Error(sql);return{rows:rows as R[]};}};
 const db:DatabasePort={withTenant:async(org,fn)=>{expect(org).toBe(targetP.orgId);const before=Y.encodeStateAsUpdate(targetDoc),count=publishedAssets.length,oldReceipts=new Map(receipts),oldSeq=seq;try{const result=await fn(session);if(fail)throw new Error('commit failure');return result;}catch(error){targetDoc.destroy();targetDoc=createWhiteboardDocument();Y.applyUpdate(targetDoc,before);publishedAssets.splice(count);receipts.clear();for(const [key,value] of oldReceipts)receipts.set(key,value);seq=oldSeq;throw error;}},withoutTenant:async()=>{throw new Error('unscoped');},close:async()=>{}};
 const collaboration={load:async()=>({epoch:1,seq:7,update:Y.encodeStateAsUpdate(sourceDoc),role:'owner',archived:false}),writeCommandsInTransaction:async(current:TenantSession,_p:unknown,_id:unknown,input:any)=>{expect(current).toBe(session);executeCommands(targetDoc,input.commands,{});return{epoch:1,seq:++seq,replayed:false,durability:'pending',update:new Uint8Array(),updateId:input.requestId,gestureId:input.requestId};}} as unknown as WhiteboardCollaborationStore;
 const images=new WhiteboardImageAssets(boards,{get:async()=>({objectKey:sourceKey,metadata:asset.metadata}),save:async()=>{},savePending:async()=>{}},objects,verifier);
 const validator={objects:async(update:Uint8Array)=>{const doc=createWhiteboardDocument();Y.applyUpdate(doc,update);const result=readObjects(doc);doc.destroy();return result;}} as WhiteboardUpdateValidator;
 const service=new PortableBoardService(boards,collaboration,validator,images,verifier,new PgPortableBoard(db,collaboration,objects,new PgBoardImageAssets(db)));
 return{service,p,targetP,source,target,objects,png,sourceKey,publishedAssets,sourceObjects:readObjects(sourceDoc),getTarget:()=>readObjects(targetDoc),queries,revokeWhileWaitingForBoardLock:()=>{revokeAtLock=true;},failCommit:()=>{fail=true;},deny:()=>{allowed=false;}};
}
const upload=(body:unknown)=>{const bytes=Buffer.from(JSON.stringify(body));return{sizeBytes:bytes.length,sha256:portableHash(bytes),contentBase64:bytes.toString('base64')};};
it('round-trips canonical geometry, hierarchy, connector and real image bytes across tenants',async()=>{
 const f=await fixture(),exported=await f.service.export(f.p,f.source),bundle=JSON.parse(Buffer.from(exported.contentBase64,'base64').toString()),requestId=randomUUID();
 expect(JSON.stringify(bundle)).not.toContain('whiteboards/tenants/');expect(bundle.media[0].path).toBe(`images/${portableHash(f.png)}`);
 const input={requestId,expectedEpoch:1,file:upload(bundle)},ack=await f.service.import(f.targetP,f.target,input);expect(ack).toMatchObject({objectCount:4,assetCount:1,replayed:false});
 const objects=f.getTarget(),note=objects.find(object=>object.kind==='sticky')!,image=objects.find(object=>object.kind==='image')!,frame=objects.find(object=>object.kind==='frame')!,edge=objects.find(object=>object.kind==='connector')!;
 expect(note).toMatchObject({text:'中文 + English',locked:true,parentId:frame.id,geometry:f.sourceObjects.find(object=>object.id==='note')!.geometry});expect(edge.connector).toMatchObject({from:note.id,to:image.id});
 expect(image.extensionData?.contentObject).toMatchObject({crop:{x:.1,y:.2,width:.7,height:.6},opacity:.8,persistence:'durable'});
 const ref=f.publishedAssets.find(asset=>asset.metadata);expect(ref.key).toContain(`/boards/${f.target}/assets/`);expect(ref.key).not.toBe(f.sourceKey);const copied=await f.objects.get(ref.key);expect(Buffer.from(copied!)).toEqual(f.png);expect((await sharp(copied!).metadata()).width).toBe(64);
 expect(await f.service.import(f.targetP,f.target,input)).toMatchObject({replayed:true});expect(f.getTarget()).toHaveLength(4);
 bundle.objects.content[0].text='changed';bundle.objects.sizeBytes=Buffer.byteLength(JSON.stringify(bundle.objects.content));bundle.objects.sha256=portableHash(JSON.stringify(bundle.objects.content));await expect(f.service.import(f.targetP,f.target,{...input,file:upload(bundle)})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
it('rejects media tampering, unsafe paths, missing media and duplicate source IDs before publication',async()=>{
 for(const mutate of [(b:any)=>{b.media[0].path='../escape';},(b:any)=>{b.media[0].sha256='0'.repeat(64);},(b:any)=>{b.media=[];},(b:any)=>{b.objects.content.push(b.objects.content[0]);b.objects.sizeBytes=Buffer.byteLength(JSON.stringify(b.objects.content));b.objects.sha256=portableHash(JSON.stringify(b.objects.content));}]){const f=await fixture(),out=await f.service.export(f.p,f.source),body=JSON.parse(Buffer.from(out.contentBase64,'base64').toString());mutate(body);await expect(f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:upload(body)})).rejects.toThrow();expect(f.getTarget()).toEqual([]);expect(f.publishedAssets).toEqual([]);}
});
it('rolls back image refs and canonical objects together on commit failure',async()=>{
 const f=await fixture(),out=await f.service.export(f.p,f.source);f.failCommit();await expect(f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:{sizeBytes:out.sizeBytes,sha256:out.sha256,contentBase64:out.contentBase64}})).rejects.toThrow('commit failure');expect(f.getTarget()).toEqual([]);expect(f.publishedAssets).toEqual([]);
});
it('keeps legacy standard JSON import without media and checks fresh ACL',async()=>{
 const f=await fixture();expect(await f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:upload({format:'workspacex.board.v1',board:{id:f.source,epoch:1,seq:0},objects:[base('plain')]})})).toMatchObject({assetCount:0,objectCount:1});f.deny();await expect(f.service.export(f.p,f.source)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('publishes multiple small command batches atomically without truncating a larger board',async()=>{
 const f=await fixture(),objects=Array.from({length:401},(_,index)=>base(`note-${index}`));
 const result=await f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:upload({format:'workspacex.board.v1',objects})});expect(result).toMatchObject({objectCount:401,seq:3});expect(f.getTarget()).toHaveLength(401);
});

it('reads membership only after the board lock and rejects a revocation committed while waiting',async()=>{
 const f=await fixture(),out=await f.service.export(f.p,f.source);f.revokeWhileWaitingForBoardLock();
 await expect(f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:{sizeBytes:out.sizeBytes,sha256:out.sha256,contentBase64:out.contentBase64}})).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(f.queries).toHaveLength(2);expect(f.queries[0]).toMatch(/^SELECT owner_id.*FOR UPDATE$/);expect(f.queries[1]).toMatch(/^SELECT role FROM whiteboard_members/);expect(f.getTarget()).toEqual([]);expect(f.publishedAssets).toEqual([]);
});

it('includes and rebinds media used only inside a template blueprint',async()=>{
 const f=await fixture(true),out=await f.service.export(f.p,f.source),bundle=JSON.parse(Buffer.from(out.contentBase64,'base64').toString());expect(bundle.media).toHaveLength(1);
 await f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:{sizeBytes:out.sizeBytes,sha256:out.sha256,contentBase64:out.contentBase64}});
 const template=f.getTarget().find(object=>object.kind==='extension')!;expect((template.extensionData!.contentObject as any).objects[0].content).toMatchObject({type:'image',persistence:'durable',sourceUrl:null});expect(f.publishedAssets.find(asset=>asset.metadata).key).toContain(`/boards/${f.target}/assets/`);
 await expect(f.service.import(f.targetP,f.target,{requestId:randomUUID(),expectedEpoch:1,file:upload({format:'workspacex.board.v1',objects:bundle.objects.content})})).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
});

it('preserves complete stored content without materializing read-time shape or image defaults',async()=>{
 const f=await fixture(false,true),exported=await f.service.export(f.p,f.source),bundle=JSON.parse(Buffer.from(exported.contentBase64,'base64').toString());
 expect(bundle.objects.content).toEqual(f.sourceObjects);
 expect(bundle.objects.content.find((o:WhiteboardObject)=>o.id==='diamond').extensionData.contentObject).not.toHaveProperty('semanticRole');
 expect(bundle.objects.content.find((o:WhiteboardObject)=>o.id==='image').extensionData.contentObject).not.toHaveProperty('retryCount');
 const requestId=randomUUID();await f.service.import(f.targetP,f.target,{requestId,expectedEpoch:1,file:upload(bundle)});
 const mapped=new Map(f.sourceObjects.map(object=>[object.id,`portable_${portableHash(`${requestId}:${object.id}`).slice(0,32)}`]));
 const expected=f.sourceObjects.map(original=>{const object=structuredClone(original);object.id=mapped.get(original.id)!;object.parentId=original.parentId?mapped.get(original.parentId)!:null;if(object.connector)object.connector={...object.connector,from:object.connector.from?mapped.get(object.connector.from):undefined,to:object.connector.to?mapped.get(object.connector.to):undefined};return object;}).sort((a,b)=>a.orderKey.localeCompare(b.orderKey)||a.id.localeCompare(b.id));
 expect(f.getTarget()).toEqual(expected);
});
