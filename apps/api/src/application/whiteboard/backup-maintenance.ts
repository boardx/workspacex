import {z} from 'zod';
import type {Principal} from '../../domain/principal';
import type {ObjectStore} from '../artifact/ports';
import {ObjectExistsError} from '../artifact/ports';
import {backupHash,backupTenant,validateBackupManifest,type BackupRecord,type BackupBlob} from './board-backup';
const id=z.string().uuid();
export const MaintenanceRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('release-pins'),backupId:id,requestId:id,retentionDays:z.number().int().min(1).max(36500).default(30)}).strict(),
 z.object({action:z.literal('recover-manifest'),backupId:id,requestId:id,boardId:id,expectedEpoch:z.number().int().positive(),expectedSeq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),targetVersion:z.literal(1)}).strict(),
]);
export type MaintenanceRequest=z.infer<typeof MaintenanceRequest>;
export class BackupMaintenanceError extends Error{constructor(readonly code:string){super(code);}}
export interface CurrentSnapshot {epoch:number;seq:number;manifestVersion:number|null;hash:string|null;bytes:number|null;key:string|null;inline:boolean;}
export interface MaintenanceReceipt {action:MaintenanceRequest['action'];requestId:string;backupId:string;boardId:string|null;requestHash:string;releasedPins:number;objectKey:string|null;}
export interface MaintenanceState {backup:BackupRecord;createdAt:Date;activePins:number;activeRestores:number;snapshot:CurrentSnapshot|null;receipt:MaintenanceReceipt|null;}
export interface BackupMaintenancePort {
 inspect(p:Principal,request:MaintenanceRequest):Promise<MaintenanceState>;
 release(p:Principal,request:Extract<MaintenanceRequest,{action:'release-pins'}>,expectedHash:string,cutoff:Date,requestHash:string):Promise<MaintenanceReceipt>;
 recover(p:Principal,request:Extract<MaintenanceRequest,{action:'recover-manifest'}>,expectedHash:string,ref:BackupBlob,requestHash:string):Promise<MaintenanceReceipt>;
}
function fail(code:string):never{throw new BackupMaintenanceError(code);}
export function validateMaintenanceState(state:MaintenanceState,request:MaintenanceRequest,now:Date){
 if(state.backup.status!=='verified'||!state.backup.manifestHash)fail('BACKUP_NOT_VERIFIED');
 if(request.action==='release-pins'){
  if(state.createdAt.getTime()>now.getTime()-request.retentionDays*86400000)fail('RETENTION_NOT_ELAPSED');
  if(state.activeRestores>0)fail('RESTORE_IN_PROGRESS');
 }else{
  const current=state.snapshot,m=state.backup.manifest;
  if(!current||current.inline||current.manifestVersion!==1||request.targetVersion!==1)fail('UNSUPPORTED_STORAGE_DOWNGRADE');
  if(m.board.id!==request.boardId||current.epoch!==request.expectedEpoch||current.seq!==request.expectedSeq||m.revision.epoch!==current.epoch||m.revision.seq!==current.seq||current.hash!==m.snapshot.hash||current.bytes!==m.snapshot.bytes)fail('CURRENT_CONTENT_CHANGED');
 }
}
export class BackupMaintenanceService{
 constructor(private readonly repository:BackupMaintenancePort,private readonly primary:Pick<ObjectStore,'get'|'head'|'putOnce'>,private readonly archive:Pick<ObjectStore,'get'|'head'>,private readonly now:()=>Date=()=>new Date()){}
 private async read(ref:BackupBlob,store:Pick<ObjectStore,'get'|'head'>){const head=await store.head(ref.key),bytes=await store.get(ref.key);if(!head||!bytes||head.sizeBytes!==ref.bytes||head.mime!==ref.mime||bytes.length!==ref.bytes||backupHash(bytes)!==ref.hash)fail('BACKUP_INTEGRITY_FAILED');return bytes;}
 async run(p:Principal,raw:unknown,execute=false){
  const request=MaintenanceRequest.parse(raw),requestHash=backupHash(JSON.stringify(request)),state=await this.repository.inspect(p,request);
  if(state.receipt){if(state.receipt.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return{mode:execute?'execute':'dry-run',replayed:true,...state.receipt};}
  validateMaintenanceState(state,request,this.now());const m=validateBackupManifest(state.backup.manifest);
  if(m.orgId!==p.orgId||m.backupId!==request.backupId)fail('NOT_FOUND');
  const archivePrefix=`board-backups/${backupTenant(p.orgId)}/${m.backupId}`;
  const manifest=await this.read({key:`${archivePrefix}/manifest.json`,hash:state.backup.manifestHash!,bytes:Buffer.byteLength(JSON.stringify(m)),mime:'application/json'},this.archive);
  if(JSON.stringify(validateBackupManifest(JSON.parse(Buffer.from(manifest).toString())))!==JSON.stringify(m))fail('BACKUP_INTEGRITY_FAILED');
  let snapshot:Uint8Array|null=null;
  for(const ref of [m.snapshot,...m.images.map(item=>item.blob),...m.comments.map(item=>item.blob)]){const bytes=await this.read({...ref,key:`${archivePrefix}/blobs/${ref.hash}`},this.archive);if(ref===m.snapshot)snapshot=bytes;}
  const objectKey=request.action==='recover-manifest'?`whiteboards/tenants/${backupTenant(p.orgId)}/boards/${request.boardId}/epochs/${request.expectedEpoch}/recovered/${request.requestId}-${m.snapshot.hash}.yjs`:null;
  if(!execute)return{mode:'dry-run',replayed:false,action:request.action,backupId:request.backupId,requestId:request.requestId,eligible:true,activePins:state.activePins,objectKey};
  let receipt:MaintenanceReceipt;
  if(request.action==='release-pins')receipt=await this.repository.release(p,request,state.backup.manifestHash!,new Date(this.now().getTime()-request.retentionDays*86400000),requestHash);
  else{const ref={...m.snapshot,key:objectKey!};try{await this.primary.putOnce(ref.key,snapshot!,'application/vnd.yjs-update');}catch(error){if(!(error instanceof ObjectExistsError))throw error;}await this.read(ref,this.primary);receipt=await this.repository.recover(p,request,state.backup.manifestHash!,ref,requestHash);}
  return{mode:'execute',replayed:false,...receipt};
 }
}
