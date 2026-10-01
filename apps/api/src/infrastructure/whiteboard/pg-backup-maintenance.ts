import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {Principal} from '../../domain/principal';
import {backupHash,validateBackupManifest,type BackupBlob,type BackupRecord} from '../../application/whiteboard/board-backup';
import {BackupMaintenanceError,validateMaintenanceState,type BackupMaintenancePort,type MaintenanceState,type MaintenanceRequest,type MaintenanceReceipt,type CurrentSnapshot} from '../../application/whiteboard/backup-maintenance';
import {lockStorageOperatorMembership} from './storage-maintenance-access';
const fail=(code:string):never=>{throw new BackupMaintenanceError(code);};
export class PgBackupMaintenance implements BackupMaintenancePort{
 constructor(private readonly db:DatabasePort){}
 private async state(s:TenantSession,p:Principal,request:MaintenanceRequest):Promise<MaintenanceState>{
  const actor=await lockStorageOperatorMembership(s,p);
  // Read the source ID first, but disclose nothing before its fresh owner check.
  const source=await s.query<{source_board_id:string;actor_id:string}>(`SELECT source_board_id,actor_id FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2`,[p.orgId,request.backupId]);
  if(!source.rows[0])fail('NOT_FOUND');const owner=source.rows[0]!;
  if(request.action==='recover-manifest'&&owner.source_board_id!==request.boardId)fail('NOT_FOUND');
  const boards=await s.query<{owner_id:string}>(`SELECT owner_id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,owner.source_board_id]);
  if(!actor.administrator&&((boards.rows[0]&&boards.rows[0].owner_id!==p.userId)||(!boards.rows[0]&&owner.actor_id!==p.userId)))fail('NOT_FOUND');
  if(request.action==='recover-manifest'&&!boards.rows[0])fail('NOT_FOUND');
  const records=await s.query<{capture:unknown;status:BackupRecord['status'];manifest_hash:string|null;created_at:Date}>(`SELECT capture,status,manifest_hash,created_at FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2 FOR UPDATE`,[p.orgId,request.backupId]);
  const row=records.rows[0];if(!row)fail('NOT_FOUND');const manifest=validateBackupManifest(row!.capture);
  if(row!.status==='verified'&&backupHash(JSON.stringify(manifest))!==row!.manifest_hash)fail('BACKUP_INTEGRITY_FAILED');
  const pins=await s.query<{n:string}>(`SELECT count(*)::text n FROM whiteboard_backup_pins WHERE org_id=$1 AND backup_id=$2 AND released_at IS NULL`,[p.orgId,request.backupId]);
  const restores=await s.query<{n:string}>(`SELECT count(*)::text n FROM whiteboard_backup_restores WHERE org_id=$1 AND backup_id=$2 AND status='preparing'`,[p.orgId,request.backupId]);
  const receipts=await s.query<{payload:MaintenanceReceipt;actor_id:string}>(`SELECT payload,actor_id FROM whiteboard_backup_maintenance_receipts WHERE org_id=$1 AND request_id=$2`,[p.orgId,request.requestId]);
  if(receipts.rows[0]&&receipts.rows[0].actor_id!==p.userId)fail('IDEMPOTENCY_CONFLICT');
  let snapshot:CurrentSnapshot|null=null;
  if(request.action==='recover-manifest'){const docs=await s.query<{epoch:number;seq:string;manifest_version:number|null;content_hash:string|null;byte_size:string|null;object_key:string|null;inline:boolean}>(`SELECT epoch,seq::text,manifest_version,content_hash,byte_size::text,object_key,snapshot IS NOT NULL AS inline FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 FOR UPDATE`,[p.orgId,request.boardId]);const doc=docs.rows[0];if(doc)snapshot={epoch:doc.epoch,seq:Number(doc.seq),manifestVersion:doc.manifest_version,hash:doc.content_hash,bytes:doc.byte_size===null?null:Number(doc.byte_size),key:doc.object_key,inline:doc.inline};}
  return {backup:{manifest,status:row!.status,manifestHash:row!.manifest_hash},createdAt:new Date(row!.created_at),activePins:Number(pins.rows[0]?.n??0),activeRestores:Number(restores.rows[0]?.n??0),snapshot,receipt:receipts.rows[0]?.payload??null};
 }
 inspect(p:Principal,request:MaintenanceRequest){return this.db.withTenant(p.orgId,s=>this.state(s,p,request));}
 private replay(state:MaintenanceState,requestHash:string){if(state.receipt&&state.receipt.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return state.receipt;}
 private async save(s:TenantSession,p:Principal,receipt:MaintenanceReceipt){await s.query(`INSERT INTO whiteboard_backup_maintenance_receipts(org_id,request_id,backup_id,actor_id,action,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,receipt.requestId,receipt.backupId,p.userId,receipt.action,JSON.stringify(receipt)]);return receipt;}
 release(p:Principal,request:Extract<MaintenanceRequest,{action:'release-pins'}>,expectedHash:string,cutoff:Date,requestHash:string){return this.db.withTenant(p.orgId,async s=>{
  const state=await this.state(s,p,request),replay=this.replay(state,requestHash);if(replay)return replay;
  if(state.backup.manifestHash!==expectedHash)fail('BACKUP_CHANGED');if(state.backup.status!=='verified')fail('BACKUP_NOT_VERIFIED');if(state.createdAt>cutoff)fail('RETENTION_NOT_ELAPSED');if(state.activeRestores)fail('RESTORE_IN_PROGRESS');
  const released=await s.query<{object_key:string}>(`UPDATE whiteboard_backup_pins SET released_at=now() WHERE org_id=$1 AND backup_id=$2 AND released_at IS NULL RETURNING object_key`,[p.orgId,request.backupId]);
  return this.save(s,p,{action:request.action,requestId:request.requestId,backupId:request.backupId,boardId:null,requestHash,releasedPins:released.rows.length,objectKey:null});
 });}
 recover(p:Principal,request:Extract<MaintenanceRequest,{action:'recover-manifest'}>,expectedHash:string,ref:BackupBlob,requestHash:string){return this.db.withTenant(p.orgId,async s=>{
  const state=await this.state(s,p,request),replay=this.replay(state,requestHash);if(replay)return replay;validateMaintenanceState(state,request,new Date());if(state.backup.manifestHash!==expectedHash)fail('BACKUP_CHANGED');
  const expectedKey=`whiteboards/tenants/${backupHash(p.orgId).slice(0,32)}/boards/${request.boardId}/epochs/${request.expectedEpoch}/recovered/${request.requestId}-${state.snapshot!.hash}.yjs`;
  if(ref.key!==expectedKey||ref.hash!==state.snapshot!.hash||ref.bytes!==state.snapshot!.bytes||ref.mime!=='application/vnd.yjs-update')fail('BACKUP_INTEGRITY_FAILED');
  const updated=await s.query(`UPDATE whiteboard_documents SET object_key=$5,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$4 AND content_hash=$6 AND snapshot IS NULL AND manifest_version=1 RETURNING board_id`,[p.orgId,request.boardId,request.expectedEpoch,request.expectedSeq,ref.key,ref.hash]);if(!updated.rows.length)fail('CURRENT_CONTENT_CHANGED');
  return this.save(s,p,{action:request.action,requestId:request.requestId,backupId:request.backupId,boardId:request.boardId,requestHash,releasedPins:0,objectKey:ref.key});
 });}
}
