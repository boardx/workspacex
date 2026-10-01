import {createHash,randomUUID} from 'node:crypto';
import {WhiteboardOperationReceipt} from '@repo/contracts/whiteboard-operation';
import type {Principal} from '../../domain/principal';
import type {TenantSession} from '../../application/ports/database.port';
import {ObjectExistsError, type ObjectStore} from '../../application/artifact/ports';
import {canonicalSnapshotKey,validSnapshotReference} from './snapshot-reference';
import type {WhiteboardCollaborationStore} from '../../application/whiteboard/collaboration-ports';
import type {WhiteboardOperationUndoStore,OperationBeforeReference,StoredOperationUndo,UndoCommentState} from '../../application/whiteboard/operation-undo-ports';
import {WhiteboardOperationError as Fault} from '../../application/whiteboard/operation-service';
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** Reuses the immutable canonical pre-operation snapshot. PG stores references and
 * comment status metadata only; existing asset roots fence GC for retained Undo. */
export class PgWhiteboardOperationUndoStore implements WhiteboardOperationUndoStore{
 constructor(private collaboration:WhiteboardCollaborationStore,private objects:Pick<ObjectStore,'get'|'putOnce'>){}
 async capture(session:TenantSession,p:Principal,boardId:string):Promise<OperationBeforeReference>{
  const snapshot=await this.collaboration.loadInTransaction(session,p,boardId);
  const result=await session.query<{epoch:number;seq:string;object_key:string;content_hash:string;byte_size:string}>('SELECT epoch,seq::text,object_key,content_hash,byte_size::text FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
  const row=result.rows[0];if(!row?.object_key)throw new Fault('DEPENDENCY_UNAVAILABLE');
  const before={epoch:row.epoch,seq:Number(row.seq),key:row.object_key,hash:row.content_hash,bytes:Number(row.byte_size)};
  if(!validSnapshotReference(p.orgId,boardId,before,true)||snapshot.epoch!==before.epoch||snapshot.seq!==before.seq||snapshot.update.byteLength!==before.bytes||hash(snapshot.update)!==before.hash)throw new Fault('DEPENDENCY_UNAVAILABLE');
  const key=canonicalSnapshotKey(p.orgId,boardId,before);
  if(before.key!==key){
   try{await this.objects.putOnce(key,new Uint8Array(snapshot.update),'application/vnd.yjs-update');}catch(error){if(!(error instanceof ObjectExistsError))throw new Fault('DEPENDENCY_UNAVAILABLE');}
   // Immutable-write conflicts are safe only after byte-for-byte integrity readback.
   await this.readBefore(p,boardId,{...before,key,comments:[]});
  }
  const comments=await session.query<UndoCommentState>("SELECT id,status,revision FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND status<>'object-deleted'",[p.orgId,boardId]);
  return{...before,key,comments:comments.rows.map(value=>({...value,revision:Number(value.revision)}))};
 }
 async record(session:TenantSession,p:Principal,receipt:WhiteboardOperationReceipt,before:OperationBeforeReference){
  const current=before.comments.length?await session.query<UndoCommentState>('SELECT id,status,revision FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND id=ANY($3::uuid[])',[p.orgId,receipt.boardId,before.comments.map(c=>c.id)]):{rows:[]};
  const archived=before.comments.filter(old=>current.rows.some(row=>row.id===old.id&&row.status==='object-deleted'&&Number(row.revision)===old.revision+1));
  await session.query("INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at) VALUES($1,$2,$3,$4,$5,'active',now()) ON CONFLICT(org_id,board_id,object_key) DO UPDATE SET state='active',released_at=NULL",[p.orgId,receipt.boardId,before.key,before.hash,before.bytes]);
  await session.query('INSERT INTO whiteboard_operation_undo(org_id,board_id,operation_id,owner_user_id,undo_id,before_epoch,before_seq,object_key,content_hash,byte_size,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',[p.orgId,receipt.boardId,receipt.operationId,p.userId,randomUUID(),before.epoch,before.seq,before.key,before.hash,before.bytes,JSON.stringify(archived)]);
 }
 async get(session:TenantSession,p:Principal,boardId:string,operationId:string):Promise<StoredOperationUndo|null>{
  const rows=await session.query<{owner_user_id:string;undo_id:string;before_epoch:number;before_seq:string;object_key:string;content_hash:string;byte_size:string;comments:UndoCommentState[];receipt:unknown}>('SELECT u.owner_user_id,u.undo_id,u.before_epoch,u.before_seq::text,u.object_key,u.content_hash,u.byte_size::text,u.comments,o.receipt FROM whiteboard_operation_undo u JOIN whiteboard_operations o ON o.org_id=u.org_id AND o.board_id=u.board_id AND o.operation_id=u.operation_id WHERE u.org_id=$1 AND u.board_id=$2 AND u.operation_id=$3',[p.orgId,boardId,operationId]);
  const row=rows.rows[0];return row?{ownerUserId:row.owner_user_id,undoId:row.undo_id,receipt:WhiteboardOperationReceipt.parse(row.receipt),before:{epoch:row.before_epoch,seq:Number(row.before_seq),key:row.object_key,hash:row.content_hash,bytes:Number(row.byte_size),comments:row.comments}}:null;
 }
 async readBefore(p:Principal,boardId:string,value:OperationBeforeReference){
  if(!validSnapshotReference(p.orgId,boardId,value))throw new Fault('DEPENDENCY_UNAVAILABLE');
  let bytes:Uint8Array|null;try{bytes=await this.objects.get(value.key);}catch{throw new Fault('DEPENDENCY_UNAVAILABLE');}
  if(!bytes||bytes.byteLength!==value.bytes||hash(bytes)!==value.hash)throw new Fault('DEPENDENCY_UNAVAILABLE');return bytes;
 }
 async checkComments(session:TenantSession,p:Principal,boardId:string,value:OperationBeforeReference){
  for(const old of value.comments){const result=await session.query<UndoCommentState>('SELECT id,status,revision FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE',[p.orgId,boardId,old.id]);const current=result.rows[0];if(current?.status!=='object-deleted'||Number(current.revision)!==old.revision+1)throw new Fault('STALE_REVISION');}
 }
 async restoreComments(session:TenantSession,p:Principal,boardId:string,value:OperationBeforeReference){
  for(const old of value.comments){const result=await session.query("UPDATE whiteboard_comment_threads SET status=$4,revision=revision+1,payload=jsonb_set(jsonb_set(jsonb_set(payload,'{status}',to_jsonb($4::text)),'{revision}',to_jsonb(revision+1)),'{archivedAt}','null'::jsonb),updated_at=now() WHERE org_id=$1 AND board_id=$2 AND id=$3 AND status='object-deleted' AND revision=$5 RETURNING id",[p.orgId,boardId,old.id,old.status,old.revision+1]);if(result.rows.length!==1)throw new Fault('STALE_REVISION');}
 }
}
