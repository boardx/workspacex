import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as Y from 'yjs';
import { createWhiteboardDocument, readObjects, readContentObject, validateDocument } from '@repo/whiteboard-core';
import { WhiteboardAssetMetadata } from '@repo/contracts/whiteboard-asset';
import { CommentBackupDescriptorSchema, type CommentBackupDescriptor } from './comment-backup-contract';
import type { Principal } from '../../domain/principal';
import { ObjectExistsError, type ObjectStore } from '../artifact/ports';

export const backupHash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const backupTenant=(org:string)=>backupHash(org).slice(0,32);
const Id=z.string().uuid(), Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const BackupBlob=z.object({key:z.string().min(1).max(1024),hash:Hash,bytes:z.number().int().positive().max(33554432),mime:z.string().min(1).max(128)}).strict();
export const BoardBackupManifest=z.object({version:z.literal(1),backupId:Id,orgId:z.string().min(1),capturedAt:z.string().datetime(),
  board:z.object({id:Id,name:z.string().trim().min(1).max(200),ownerId:z.string().min(1),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),archived:z.boolean(),lifecycleRevision:z.number().int().nonnegative(),tagsRevision:z.number().int().nonnegative(),members:z.array(z.object({userId:z.string().min(1),role:z.enum(['editor','commenter','viewer'])}).strict()).max(10000),tags:z.array(z.object({id:Id,name:z.string(),revision:z.number().int().positive()}).strict()).max(1000)}).strict(),
  revision:z.object({epoch:z.number().int().positive(),seq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),snapshot:BackupBlob,
  images:z.array(z.object({blob:BackupBlob,metadata:WhiteboardAssetMetadata}).strict()).max(5000),comments:z.array(CommentBackupDescriptorSchema).max(10000),
  // Optional, not defaulted: preserve the exact hash of already-issued v1 manifests.
  sourceHistory:z.array(BackupBlob).max(20000).optional(),
}).strict();
export type BoardBackupManifest=z.infer<typeof BoardBackupManifest>;
export type BackupBlob=z.infer<typeof BackupBlob>;
export interface BackupRecord {manifest:BoardBackupManifest;status:'preparing'|'verified'|'failed_pending_cleanup';manifestHash:string|null;}
export interface RestoreRefs {snapshot:BackupBlob;images:Array<{blob:BackupBlob;metadata:z.infer<typeof WhiteboardAssetMetadata>}>;comments:CommentBackupDescriptor[];}
/** PG contains only bounded metadata/immutable pointers. No document/image bytes enter this port. */
export interface BoardBackupRepository {
  capture(p:Principal,boardId:string,backupId:string):Promise<BackupRecord>;
  withSourceRestore?(p:Principal,manifest:BoardBackupManifest,publish:()=>Promise<void>):Promise<void>;
  read(p:Principal,backupId:string):Promise<BackupRecord>;
  verified(p:Principal,backupId:string,manifestHash:string):Promise<void>;
  failed(p:Principal,backupId:string):Promise<void>;
  prepareRestore(p:Principal,manifest:BoardBackupManifest,restoreId:string,refs:RestoreRefs):Promise<{completed:boolean}>;
  publishRestore(p:Principal,manifest:BoardBackupManifest,restoreId:string,refs:RestoreRefs):Promise<void>;
}
export class BoardBackupError extends Error {constructor(readonly code:string){super(code);}}
function fail(code='BACKUP_INTEGRITY_FAILED'):never{throw new BoardBackupError(code);}
export function validateBackupManifest(input:unknown):BoardBackupManifest {
  const m=BoardBackupManifest.parse(input),prefix=`whiteboards/tenants/${backupTenant(m.orgId)}/boards/${m.board.id}/`;
  if(!m.snapshot.key.startsWith(prefix)||m.snapshot.key.split('/').some(part=>!part||part==='.'||part==='..')||/[\\\x00-\x1f]/.test(m.snapshot.key)||m.snapshot.mime!=='application/vnd.yjs-update')fail();
  if(new Set(m.images.map(i=>i.metadata.assetId)).size!==m.images.length ||new Set(m.board.members.map(i=>i.userId)).size!==m.board.members.length ||new Set(m.board.tags.map(i=>i.id)).size!==m.board.tags.length)fail();
  for(const image of m.images){const {blob,metadata}=image;if(blob.key!==`${prefix}assets/${blob.hash}`||metadata.assetId!==`board-image-${blob.hash}`||metadata.contentDigest!==`sha256:${blob.hash}`||metadata.byteSize!==blob.bytes||metadata.mimeType!==blob.mime)fail();}
  if(new Set(m.comments.map(c=>c.id)).size!==m.comments.length)fail();
  for(const c of m.comments){if(c.blob.key!==`${prefix}comment-bodies/${c.blob.hash}.json`||c.metadata.boardId!==m.board.id||c.metadata.id!==c.id||c.metadata.objectId!==c.objectId||c.metadata.status!==c.status||c.metadata.revision!==c.revision||c.metadata.comments.some(item=>item.boardId!==m.board.id||item.threadId!==c.id))fail();}
  const primaryKeys=new Set([m.snapshot.key,...m.images.map(i=>i.blob.key),...m.comments.map(c=>c.blob.key)]);
  for(const ref of m.sourceHistory??[]){
    if(!ref.key.startsWith(prefix)||ref.key.split('/').some(part=>!part||part==='.'||part==='..')||/[\\\x00-\x1f]/.test(ref.key)||primaryKeys.has(ref.key))fail();
    primaryKeys.add(ref.key);
  }
  return m;
}
export function boardBackupBlobs(m:BoardBackupManifest):BackupBlob[]{return[m.snapshot,...m.images.map(i=>i.blob),...m.comments.map(c=>c.blob),...(m.sourceHistory??[])];}

function verifyCanonical(bytes:Uint8Array,m:BoardBackupManifest):void{
  const doc=createWhiteboardDocument();try{Y.applyUpdate(doc,bytes);validateDocument(doc);const referenced=new Set<string>();
    for(const object of readObjects(doc)){const content=readContentObject(object);
      if(content?.type==='tile'&&content.coverAssetId)fail('UNSUPPORTED_ASSET_REFERENCE');
      if(content?.type==='template'&&content.objects?.some(item=>item.content.type==='image'||(item.content.type==='tile'&&item.content.coverAssetId)))fail('UNSUPPORTED_ASSET_REFERENCE');
      if(object.kind!=='image')continue;
      if(!content||content.type!=='image'||content.status!=='ready'||content.persistence!=='durable'||!content.assetId||content.sourceUrl)fail();
      const image=m.images.find(i=>i.metadata.assetId===content.assetId);if(!image||image.metadata.contentDigest!==content.contentDigest||image.metadata.byteSize!==content.byteSize||image.metadata.mimeType!==content.mimeType||image.metadata.intrinsicWidth!==content.intrinsicWidth||image.metadata.intrinsicHeight!==content.intrinsicHeight)fail();referenced.add(content.assetId);
    }if(referenced.size!==m.images.length)fail();
    const ids=new Set(readObjects(doc).map(o=>o.id));for(const thread of m.comments)if(thread.objectId!==null&&thread.status!=='object-deleted'&&!ids.has(thread.objectId))fail('COMMENT_OBJECT_MISSING');
  }finally{doc.destroy();}
}
export function boardRestoreRefs(m:BoardBackupManifest,targetId:string):RestoreRefs {
  Id.parse(targetId);const prefix=`whiteboards/tenants/${backupTenant(m.orgId)}/boards/${targetId}`;
  return{snapshot:{...m.snapshot,key:`${prefix}/epochs/1/snapshots/0-${m.snapshot.hash}.yjs`},images:m.images.map(i=>({metadata:i.metadata,blob:{...i.blob,key:`${prefix}/assets/${i.blob.hash}`}})),comments:m.comments.map(c=>({...c,blob:{...c.blob,key:`${prefix}/comment-bodies/${c.blob.hash}.json`}}))};
}
export class BoardBackupService {
  constructor(private readonly repository:BoardBackupRepository,private readonly primary:Pick<ObjectStore,'putOnce'|'get'|'head'>,private readonly secondary:Pick<ObjectStore,'putOnce'|'get'|'head'>){}
  private archiveKey(m:BoardBackupManifest,hash:string){return `board-backups/${backupTenant(m.orgId)}/${m.backupId}/blobs/${hash}`;}
  private manifestKey(m:BoardBackupManifest){return `board-backups/${backupTenant(m.orgId)}/${m.backupId}/manifest.json`;}
  private async readBlob(store:Pick<ObjectStore,'get'|'head'>,ref:BackupBlob){const head=await store.head(ref.key);if(!head||head.sizeBytes!==ref.bytes||head.mime!==ref.mime)fail();const bytes=await store.get(ref.key);if(!bytes||bytes.byteLength!==ref.bytes||backupHash(bytes)!==ref.hash)fail();return bytes;}
  private async put(store:Pick<ObjectStore,'putOnce'|'get'|'head'>,ref:BackupBlob,bytes:Uint8Array){try{await store.putOnce(ref.key,bytes,ref.mime);}catch(error){if(!(error instanceof ObjectExistsError))throw error;}await this.readBlob(store,ref);}
  async backup(p:Principal,boardId:string,backupId:string){Id.parse(boardId);Id.parse(backupId);const record=await this.repository.capture(p,boardId,backupId),m=validateBackupManifest(record.manifest);
    if(m.orgId!==p.orgId||m.board.ownerId!==p.userId||m.board.id!==boardId||m.backupId!==backupId)fail('NOT_FOUND');
    try{const snapshot=await this.readBlob(this.primary,m.snapshot);verifyCanonical(snapshot,m);
      for(const ref of boardBackupBlobs(m))await this.put(this.secondary,{...ref,key:this.archiveKey(m,ref.hash)},await this.readBlob(this.primary,ref));
      const bytes=Buffer.from(JSON.stringify(m)),hash=backupHash(bytes);await this.put(this.secondary,{key:this.manifestKey(m),hash,bytes:bytes.byteLength,mime:'application/json'},bytes);
      await this.repository.verified(p,backupId,hash);return{backupId,manifestHash:hash,source:m.revision,blobCount:boardBackupBlobs(m).length};
    }catch(error){await this.repository.failed(p,backupId).catch(()=>undefined);throw error;}
  }
  /** Disaster recovery only: fresh owner ACL + restored PG refs must match the
   * captured source. Never rebind old actor/proposal identities onto a new Board. */
  async restoreSourceFiles(p:Principal,backupId:string){
    Id.parse(backupId);const record=await this.repository.read(p,backupId);
    if(record.status!=='verified'||!record.manifestHash)fail('BACKUP_NOT_VERIFIED');
    const m=validateBackupManifest(record.manifest);
    if(m.orgId!==p.orgId||m.board.ownerId!==p.userId||m.backupId!==backupId)fail('NOT_FOUND');
    if(m.sourceHistory===undefined||!this.repository.withSourceRestore)fail('SOURCE_HISTORY_NOT_CAPTURED');
    const manifestBytes=await this.readBlob(this.secondary,{key:this.manifestKey(m),hash:record.manifestHash,bytes:Buffer.byteLength(JSON.stringify(m)),mime:'application/json'});
    if(JSON.stringify(validateBackupManifest(JSON.parse(Buffer.from(manifestBytes).toString())))!==JSON.stringify(m))fail();
    // Validate every byte before publishing any source key; reread during writes
    // avoids holding all history (up to 20k blobs) in process memory.
    for(const ref of boardBackupBlobs(m))await this.readBlob(this.secondary,{...ref,key:this.archiveKey(m,ref.hash)});
    await this.repository.withSourceRestore(p,m,async()=>{
      for(const ref of boardBackupBlobs(m))await this.put(this.primary,ref,await this.readBlob(this.secondary,{...ref,key:this.archiveKey(m,ref.hash)}));
    });
    return{boardId:m.board.id,blobCount:boardBackupBlobs(m).length};
  }
  async restore(p:Principal,backupId:string,restoreId:string){Id.parse(backupId);Id.parse(restoreId);const record=await this.repository.read(p,backupId);if(record.status!=='verified'||!record.manifestHash)fail('BACKUP_NOT_VERIFIED');
    const saved=validateBackupManifest(record.manifest);if(restoreId===saved.board.id)fail('TARGET_MUST_BE_NEW');if(saved.orgId!==p.orgId||saved.board.ownerId!==p.userId||saved.backupId!==backupId)fail('NOT_FOUND');
    const manifestBytes=await this.readBlob(this.secondary,{key:this.manifestKey(saved),hash:record.manifestHash,bytes:Buffer.byteLength(JSON.stringify(saved)),mime:'application/json'});
    const m=validateBackupManifest(JSON.parse(Buffer.from(manifestBytes).toString('utf8')));if(JSON.stringify(m)!==JSON.stringify(saved))fail();
    const snapshot=await this.readBlob(this.secondary,{...m.snapshot,key:this.archiveKey(m,m.snapshot.hash)});verifyCanonical(snapshot,m);
    // Validate every archive object before the first target write. Never trust manifest alone.
    for(const image of m.images)await this.readBlob(this.secondary,{...image.blob,key:this.archiveKey(m,image.blob.hash)});
    for(const c of m.comments)await this.readBlob(this.secondary,{...c.blob,key:this.archiveKey(m,c.blob.hash)});
    const refs=boardRestoreRefs(m,restoreId);
    const prepared=await this.repository.prepareRestore(p,m,restoreId,refs);if(prepared.completed)return{boardId:restoreId,replayed:true};
    await this.put(this.primary,refs.snapshot,snapshot);
    for(const image of refs.images)await this.put(this.primary,image.blob,await this.readBlob(this.secondary,{...image.blob,key:this.archiveKey(m,image.blob.hash)}));
    for(const c of refs.comments)await this.put(this.primary,c.blob,await this.readBlob(this.secondary,{...c.blob,key:this.archiveKey(m,c.blob.hash)}));
    await this.repository.publishRestore(p,m,restoreId,refs);return{boardId:restoreId,replayed:false};
  }
}
