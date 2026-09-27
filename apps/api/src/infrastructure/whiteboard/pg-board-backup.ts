import { BoardBackupError, type BoardBackupManifest, validateBackupManifest, boardRestoreRefs, backupHash, type BackupRecord, type BoardBackupRepository, type RestoreRefs } from '../../application/whiteboard/board-backup';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import type { PgWhiteboardCommentStore } from './pg-whiteboard-comment-store';
import type { PgWhiteboardCollaborationStore } from './pg-collaboration-store';
import { createWhiteboardDocument, readObjects, readContentObject } from '@repo/whiteboard-core';
import * as Y from 'yjs';
import { assertPrincipal } from '../../domain/principal';

type Row={capture:unknown;status:BackupRecord['status'];manifest_hash:string|null;source_board_id:string};
function missing():never{throw new BoardBackupError('NOT_FOUND');}
/** Board lock protects capture; each durable pin additionally shares the GC object-key fence. */
export class PgBoardBackupRepository implements BoardBackupRepository {
  constructor(private readonly db:DatabasePort,private readonly collaboration:Pick<PgWhiteboardCollaborationStore,'loadInTransaction'>,private readonly comments:Pick<PgWhiteboardCommentStore,'captureBackupInTransaction'|'restoreBackupInTransaction'>){}
  private async actor(s:TenantSession,p:Principal,sourceId:string,allowMissing=false){
    assertPrincipal(p);const member=await s.query(`SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[p.orgId,p.userId]);if(!member.rows.length)missing();
    const source=await s.query<{owner_id:string}>(`SELECT owner_id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,sourceId]);
    if((!source.rows.length&&!allowMissing)||(source.rows.length&&source.rows[0]!.owner_id!==p.userId))missing();
  }
  private async record(s:TenantSession,p:Principal,id:string):Promise<Row>{
    const found=await s.query<Row>(`SELECT capture,status,manifest_hash,source_board_id FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2 AND actor_id=$3 FOR UPDATE`,[p.orgId,id,p.userId]);if(!found.rows[0])missing();return found.rows[0]!;
  }
  private decoded(row:Row):BackupRecord{return{manifest:validateBackupManifest(row.capture),status:row.status,manifestHash:row.manifest_hash};}
  private async accessRecord(s:TenantSession,p:Principal,id:string){
    const found=await s.query<{source_board_id:string}>(`SELECT source_board_id FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2 AND actor_id=$3`,[p.orgId,id,p.userId]);if(!found.rows[0])missing();
    await this.actor(s,p,found.rows[0]!.source_board_id,true);return this.record(s,p,id);
  }
  private async pins(s:TenantSession,p:Principal,backupId:string,keys:string[]){for(const key of [...new Set(keys)].sort())await s.query(`INSERT INTO whiteboard_backup_pins(org_id,backup_id,object_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[p.orgId,backupId,key]);}
  async capture(p:Principal,boardId:string,backupId:string){return this.db.withTenant(p.orgId,async s=>{
    // Match library mutation lock order: taxonomy before Board, then backup metadata/pins.
    const tags=await s.query<{id:string;name:string;revision:number}>(`SELECT t.id,t.name,t.revision FROM whiteboard_tags t JOIN whiteboard_tag_bindings bt ON bt.org_id=t.org_id AND bt.tag_id=t.id JOIN whiteboards b ON b.org_id=bt.org_id AND b.id=bt.board_id WHERE t.org_id=$1 AND b.id=$2 AND b.owner_id=$3 AND t.deleted_at IS NULL ORDER BY t.id FOR SHARE OF t`,[p.orgId,boardId,p.userId]);
    await this.actor(s,p,boardId);
    const existing=await s.query<Row>(`SELECT capture,status,manifest_hash,source_board_id FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2 AND actor_id=$3 FOR UPDATE`,[p.orgId,backupId,p.userId]);
    if(existing.rows[0]){if(existing.rows[0].source_board_id!==boardId)throw new BoardBackupError('IDEMPOTENCY_CONFLICT');return this.decoded(existing.rows[0]);}
    const comments=await this.comments.captureBackupInTransaction(s,p,boardId);
    const actualTags=await s.query<{id:string}>(`SELECT t.id FROM whiteboard_tag_bindings bt JOIN whiteboard_tags t ON t.org_id=bt.org_id AND t.id=bt.tag_id AND t.deleted_at IS NULL WHERE bt.org_id=$1 AND bt.board_id=$2 ORDER BY t.id`,[p.orgId,boardId]);if(JSON.stringify(tags.rows.map(t=>t.id))!==JSON.stringify(actualTags.rows.map(t=>t.id)))throw new BoardBackupError('SOURCE_CHANGED');
    const loaded=await this.collaboration.loadInTransaction(s,p,boardId);
    const boards=await s.query<{name:string;owner_id:string;created_at:Date;updated_at:Date;archived:boolean;lifecycle_revision:number;tags_revision:number}>(`SELECT name,owner_id,created_at,updated_at,archived,lifecycle_revision,tags_revision FROM whiteboards WHERE org_id=$1 AND id=$2`,[p.orgId,boardId]);
    const members=await s.query<{userId:string;role:'editor'|'commenter'|'viewer'}>(`SELECT user_id AS "userId",role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 ORDER BY user_id`,[p.orgId,boardId]);
    const docs=await s.query<{object_key:string;content_hash:string;byte_size:string}>(`SELECT object_key,content_hash,byte_size::text FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 AND snapshot IS NULL`,[p.orgId,boardId]);if(!docs.rows[0])throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');
    const doc=createWhiteboardDocument();let imageIds:string[];try{Y.applyUpdate(doc,loaded.update);imageIds=readObjects(doc).filter(o=>o.kind==='image').map(o=>{const c=readContentObject(o);if(c?.type!=='image'||!c.assetId)throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');return c.assetId;});}finally{doc.destroy();}
    const images=await s.query<{object_key:string;metadata:unknown}>(`SELECT a.object_key,a.metadata FROM whiteboard_image_assets a JOIN whiteboard_asset_refs r ON r.org_id=a.org_id AND r.board_id=a.board_id AND r.object_key=a.object_key WHERE a.org_id=$1 AND a.board_id=$2 AND a.asset_id=ANY($3::text[]) AND r.released_at IS NULL AND r.state='active' ORDER BY a.asset_id FOR SHARE OF a,r`,[p.orgId,boardId,imageIds]);
    const b=boards.rows[0]!,d=docs.rows[0];
    const manifest=validateBackupManifest({version:1,backupId,orgId:p.orgId,capturedAt:new Date().toISOString(),board:{id:boardId,name:b.name,ownerId:b.owner_id,createdAt:new Date(b.created_at).toISOString(),updatedAt:new Date(b.updated_at).toISOString(),archived:b.archived,lifecycleRevision:b.lifecycle_revision,tagsRevision:b.tags_revision,members:members.rows,tags:tags.rows},revision:{epoch:loaded.epoch,seq:loaded.seq},snapshot:{key:d.object_key,hash:d.content_hash,bytes:Number(d.byte_size),mime:'application/vnd.yjs-update'},comments,images:images.rows.map(row=>{const metadata=row.metadata as {contentDigest:string;byteSize:number;mimeType:string};return{metadata,blob:{key:row.object_key,hash:metadata.contentDigest.slice(7),bytes:metadata.byteSize,mime:metadata.mimeType}}})});
    if(new Set(imageIds).size!==manifest.images.length)throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');
    await s.query(`INSERT INTO whiteboard_backups(org_id,backup_id,actor_id,source_board_id,status,capture) VALUES($1,$2,$3,$4,'preparing',$5::jsonb)`,[p.orgId,backupId,p.userId,boardId,JSON.stringify(manifest)]);
    await this.pins(s,p,backupId,[manifest.snapshot.key,...manifest.images.map(i=>i.blob.key),...manifest.comments.map(c=>c.blob.key)]);return{manifest,status:'preparing' as const,manifestHash:null};
  });}
  async read(p:Principal,id:string){return this.db.withTenant(p.orgId,async s=>this.decoded(await this.accessRecord(s,p,id)));}
  async verified(p:Principal,id:string,hash:string){await this.db.withTenant(p.orgId,async s=>{const row=await this.accessRecord(s,p,id);if(row.manifest_hash&&row.manifest_hash!==hash)throw new BoardBackupError('IDEMPOTENCY_CONFLICT');await s.query(`UPDATE whiteboard_backups SET status='verified',manifest_hash=$3,updated_at=now() WHERE org_id=$1 AND backup_id=$2`,[p.orgId,id,hash]);});}
  async failed(p:Principal,id:string){await this.db.withTenant(p.orgId,async s=>{await this.accessRecord(s,p,id);await s.query(`UPDATE whiteboard_backups SET status='failed_pending_cleanup',updated_at=now() WHERE org_id=$1 AND backup_id=$2 AND status<>'verified'`,[p.orgId,id]);});}
  async prepareRestore(p:Principal,m:BoardBackupManifest,id:string,refs:RestoreRefs){if(JSON.stringify(refs)!==JSON.stringify(boardRestoreRefs(m,id)))throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');return this.db.withTenant(p.orgId,async s=>{
    const row=await this.accessRecord(s,p,m.backupId);if(row.status!=='verified'||JSON.stringify(validateBackupManifest(row.capture))!==JSON.stringify(m))throw new BoardBackupError('BACKUP_NOT_VERIFIED');
    const hash=backupHash(JSON.stringify({backupId:m.backupId,refs}));
    await s.query(`INSERT INTO whiteboard_backup_restores(org_id,restore_id,backup_id,actor_id,request_hash,status) VALUES($1,$2,$3,$4,$5,'preparing') ON CONFLICT(org_id,restore_id) DO NOTHING`,[p.orgId,id,m.backupId,p.userId,hash]);
    const found=await s.query<{request_hash:string;status:string;actor_id:string}>(`SELECT request_hash,status,actor_id FROM whiteboard_backup_restores WHERE org_id=$1 AND restore_id=$2 FOR UPDATE`,[p.orgId,id]);if(found.rows[0]?.request_hash!==hash||found.rows[0]?.actor_id!==p.userId)throw new BoardBackupError('IDEMPOTENCY_CONFLICT');
    if(found.rows[0].status==='completed')return{completed:true};
    const target=await s.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2`,[p.orgId,id]);if(target.rows.length)throw new BoardBackupError('TARGET_EXISTS');
    await this.pins(s,p,m.backupId,[refs.snapshot.key,...refs.images.map(i=>i.blob.key),...refs.comments.map(c=>c.blob.key)]);return{completed:false};
  });}
  async publishRestore(p:Principal,m:BoardBackupManifest,id:string,refs:RestoreRefs){if(JSON.stringify(refs)!==JSON.stringify(boardRestoreRefs(m,id)))throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');await this.db.withTenant(p.orgId,async s=>{
    const tags=await s.query<{id:string;name:string;revision:number}>(`SELECT id,name,revision FROM whiteboard_tags WHERE org_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`,[p.orgId,m.board.tags.map(t=>t.id)]);if(JSON.stringify(tags.rows)!==JSON.stringify(m.board.tags))throw new BoardBackupError('TAG_CHANGED');
    const row=await this.accessRecord(s,p,m.backupId);if(row.status!=='verified'||JSON.stringify(validateBackupManifest(row.capture))!==JSON.stringify(m))throw new BoardBackupError('BACKUP_NOT_VERIFIED');
    const receipt=await s.query<{status:string;request_hash:string;actor_id:string}>(`SELECT status,request_hash,actor_id FROM whiteboard_backup_restores WHERE org_id=$1 AND restore_id=$2 FOR UPDATE`,[p.orgId,id]);if(receipt.rows[0]?.actor_id!==p.userId||receipt.rows[0]?.request_hash!==backupHash(JSON.stringify({backupId:m.backupId,refs})))throw new BoardBackupError('IDEMPOTENCY_CONFLICT');if(receipt.rows[0].status==='completed')return;
    const members=[...new Set([p.userId,...m.board.members.map(member=>member.userId)])].sort();const active=await s.query<{user_id:string}>(`SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=ANY($2::text[]) ORDER BY user_id FOR SHARE`,[p.orgId,members]);if(JSON.stringify(active.rows.map(r=>r.user_id))!==JSON.stringify(members))throw new BoardBackupError('MEMBERSHIP_CHANGED');
    await s.query(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name,archived,lifecycle_revision,tags_revision) VALUES($1,$2,$3,$1,$4,$5,0,0)`,[id,p.orgId,p.userId,m.board.name,m.board.archived]);
    for(const member of m.board.members)await s.query(`INSERT INTO whiteboard_members(org_id,board_id,user_id,role) VALUES($1,$2,$3,$4)`,[p.orgId,id,member.userId,member.role]);
    for(const tag of m.board.tags)await s.query(`INSERT INTO whiteboard_tag_bindings(org_id,board_id,tag_id) VALUES($1,$2,$3)`,[p.orgId,id,tag.id]);
    for(const image of refs.images){await s.query(`INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at) VALUES($1,$2,$3,$4,$5,'active',now())`,[p.orgId,id,image.blob.key,image.blob.hash,image.blob.bytes]);await s.query(`INSERT INTO whiteboard_image_assets(org_id,board_id,asset_id,object_key,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,[p.orgId,id,image.metadata.assetId,image.blob.key,JSON.stringify(image.metadata)]);}
    await s.query(`INSERT INTO whiteboard_documents(org_id,board_id,epoch,seq,snapshot,manifest_version,object_key,content_hash,byte_size) VALUES($1,$2,1,0,NULL,1,$3,$4,$5)`,[p.orgId,id,refs.snapshot.key,refs.snapshot.hash,refs.snapshot.bytes]);
    await this.comments.restoreBackupInTransaction(s,p,id,refs.comments);
    await s.query(`UPDATE whiteboard_backup_restores SET status='completed',updated_at=now() WHERE org_id=$1 AND restore_id=$2`,[p.orgId,id]);
  });}
}
