import { ObjectExistsError, type ObjectStore } from '../artifact/ports';
import { checkpointHash, verifyCheckpoint, restoredHead } from '@repo/whiteboard-core';
import { WhiteboardCheckpointManifest, type WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';
import type { Principal } from '../../domain/principal';
import { createHash } from 'node:crypto';
export { WHITEBOARD_RECOVERY_SERVICE } from './collaboration-ports';
import * as Y from 'yjs';

export type WhiteboardRecoveryFailure = 'NOT_FOUND' | 'FORBIDDEN' | 'STALE_HEAD' | 'CHECKPOINT_INVALID' | 'DEPENDENCY_UNAVAILABLE';
export class WhiteboardRecoveryError extends Error { constructor(readonly code: WhiteboardRecoveryFailure) { super(code); } }
export interface WhiteboardRecoveryHead { epoch: number; seq: number; role: 'owner' | 'editor' | 'commenter' | 'viewer'; archived: boolean; }
export interface WhiteboardSnapshotSource { snapshot(principal: Principal, boardId: string, epoch: number, seq: number): Promise<Uint8Array>; }
export interface WhiteboardRecoveryMetadata {
  head(principal: Principal, boardId: string): Promise<WhiteboardRecoveryHead>;
  saveCheckpoint(principal: Principal, manifest: WhiteboardCheckpointManifest, requestId: string, event: WhiteboardCollaborationEvent): Promise<{ manifest: WhiteboardCheckpointManifest; replayed: boolean }>;
  getCheckpoint(principal: Principal, boardId: string, checkpointId: string): Promise<WhiteboardCheckpointManifest | null>;
  findCheckpointRequest(principal: Principal, boardId: string, requestId: string): Promise<WhiteboardCheckpointManifest|null>;
  findRestore(principal: Principal, boardId: string, requestId: string): Promise<{epoch:number;seq:0;event:WhiteboardCollaborationEvent;auditEvents:WhiteboardCollaborationEvent[]}|null>;
  recoveryCandidates(principal:Principal,boardId:string,epoch:number,beforeSeq:number):Promise<WhiteboardCheckpointManifest[]>;
  updatesBetween(principal:Principal,boardId:string,epoch:number,afterSeq:number,throughSeq:number):Promise<Array<{seq:number;update:Uint8Array}>>;
  /** Atomically CAS the old head, append BoardRestored, and point the new epoch at immutable bytes. */
  commitRestore(principal: Principal, input: { boardId: string; checkpoint: WhiteboardCheckpointManifest; snapshot: Uint8Array; newEpoch: number; expectedEpoch: number; expectedSeq: number; requestId: string; event: WhiteboardCollaborationEvent; auditEvents:WhiteboardCollaborationEvent[] }): Promise<{ epoch: number; seq: 0; replayed: boolean; auditEvents:WhiteboardCollaborationEvent[] }>;
}

/** Snapshot bytes only cross ObjectStore; repository receives immutable refs and metadata. */
export class WhiteboardRecoveryService {
  constructor(private readonly metadata: WhiteboardRecoveryMetadata, private readonly snapshots: WhiteboardSnapshotSource, private readonly objects: Pick<ObjectStore, 'putOnce' | 'get'>, private readonly now: () => Date = () => new Date()) {}
  private event(principal: Principal, manifest: WhiteboardCheckpointManifest): WhiteboardCollaborationEvent {
    return {type:'CheckpointCreated',eventId:manifest.checkpointId,operationId:manifest.checkpointId,boardId:manifest.boardId,checkpointId:manifest.checkpointId,epoch:manifest.epoch,seq:manifest.seq,actorId:principal.userId,occurredAt:manifest.createdAt};
  }
  private async verifiedExisting(principal: Principal, manifest: WhiteboardCheckpointManifest) {
    const expectedPrefix=`whiteboards/tenants/${createHash('sha256').update(principal.orgId).digest('hex').slice(0,32)}/boards/${manifest.boardId}/`;
    const legacyKey=`whiteboards/${manifest.boardId}/checkpoints/${manifest.checkpointId}.yjs`;
    if (!manifest.objectKey.startsWith(expectedPrefix) && manifest.objectKey!==legacyKey) throw new WhiteboardRecoveryError('CHECKPOINT_INVALID');
    let bytes:Uint8Array|null; try { bytes=await this.objects.get(manifest.objectKey); } catch { throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE'); } if(!bytes) throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');
    try { await verifyCheckpoint(manifest,bytes); } catch { throw new WhiteboardRecoveryError('CHECKPOINT_INVALID'); }
    return bytes;
  }
  async createCheckpoint(principal: Principal, boardId: string, requestId: string): Promise<{ manifest: WhiteboardCheckpointManifest; event: WhiteboardCollaborationEvent; replayed: boolean }> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    // Resolve an idempotent retry before sampling the moving board head. Otherwise the
    // same request after another edit hashes new bytes under the old immutable key.
    const [head, existing] = await Promise.all([this.metadata.head(principal, boardId), this.metadata.findCheckpointRequest(principal,boardId,requestId)]);
    if (!['owner','editor'].includes(head.role) || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
    if (existing) {
      await this.verifiedExisting(principal,existing);
      return {manifest:existing,replayed:true,event:this.event(principal,existing)};
    }
    const snapshot=await this.snapshots.snapshot(principal,boardId,head.epoch,head.seq);
    const checkpointId=requestId, contentHash=await checkpointHash(snapshot);
    const tenant=createHash('sha256').update(principal.orgId).digest('hex').slice(0,32);
    const manifest=WhiteboardCheckpointManifest.parse({checkpointId,boardId,version:1,epoch:head.epoch,seq:head.seq,
      objectKey:`whiteboards/tenants/${tenant}/boards/${boardId}/checkpoints/${checkpointId}-${contentHash.slice(7)}.yjs`,contentHash,byteSize:snapshot.byteLength,createdBy:principal.userId,createdAt:this.now().toISOString()});
    try { await this.objects.putOnce(manifest.objectKey, snapshot, 'application/vnd.yjs-update'); }
    catch(error) {
      if (!(error instanceof ObjectExistsError)) throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');
    }
    // Both a fresh write and an immutable replay must be readable and hash/size exact
    // before the PG manifest can make the checkpoint visible.
    await this.verifiedExisting(principal,manifest);
    let saved;
    try { saved=await this.metadata.saveCheckpoint(principal,manifest,requestId,this.event(principal,manifest)); }
    catch(error) {
      // A concurrent same-id creator can win after our initial lookup. Its content-addressed
      // blob is independent; return the committed receipt and leave ours as a safe orphan.
      if (!(error instanceof WhiteboardRecoveryError) || error.code!=='CHECKPOINT_INVALID') throw error;
      const winner=await this.metadata.getCheckpoint(principal,boardId,requestId); if(!winner) throw error;
      await this.verifiedExisting(principal,winner);
      return {manifest:winner,replayed:true,event:this.event(principal,winner)};
    }
    return {manifest:saved.manifest,replayed:saved.replayed,event:this.event(principal,saved.manifest)};
  }
  async restore(principal: Principal, boardId: string, checkpointId: string, requestId: string, expected: { epoch: number; seq: number }): Promise<{epoch:number;seq:0;replayed:boolean;event:WhiteboardCollaborationEvent;auditEvents:WhiteboardCollaborationEvent[]}> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    const [head, manifest]=await Promise.all([this.metadata.head(principal,boardId),this.metadata.getCheckpoint(principal,boardId,checkpointId)]);
    if (!manifest) throw new WhiteboardRecoveryError('NOT_FOUND');
    if (head.role !== 'owner' || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
    const replay=await this.metadata.findRestore(principal,boardId,requestId);if(replay)return{...replay,replayed:true};
    if (head.epoch!==expected.epoch || head.seq!==expected.seq) throw new WhiteboardRecoveryError('STALE_HEAD');
    let restoredManifest=manifest,bytes:Uint8Array,fallbackEvent:WhiteboardCollaborationEvent|undefined;
    try { bytes=await this.verifiedExisting(principal,manifest); }
    catch {
      const candidates=await this.metadata.recoveryCandidates(principal,boardId,manifest.epoch,manifest.seq);
      let recovered:Uint8Array|undefined;
      for(const candidate of candidates){
        try{
          const base=await this.verifiedExisting(principal,candidate);
          const updates=await this.metadata.updatesBetween(principal,boardId,candidate.epoch,candidate.seq,manifest.seq);
          if(updates.length!==manifest.seq-candidate.seq||updates.some((entry,index)=>entry.seq!==candidate.seq+index+1))continue;
          const doc=new Y.Doc();try{Y.applyUpdate(doc,base);for(const entry of updates)Y.applyUpdate(doc,entry.update);recovered=Y.encodeStateAsUpdate(doc);}finally{doc.destroy();}
          restoredManifest=candidate;break;
        }catch{/* Try the next immutable checkpoint. */}
      }
      if(!recovered)throw new WhiteboardRecoveryError('CHECKPOINT_INVALID');
      bytes=recovered;
      fallbackEvent={type:'CheckpointFallbackUsed',eventId:crypto.randomUUID(),operationId:requestId,boardId,requestedCheckpointId:manifest.checkpointId,fallbackCheckpointId:restoredManifest.checkpointId,replayedThroughSeq:manifest.seq,actorId:principal.userId,occurredAt:this.now().toISOString()};
    }
    const next=restoredHead(expected,manifest), event:WhiteboardCollaborationEvent={type:'BoardRestored',eventId:requestId,operationId:requestId,boardId,checkpointId,previousEpoch:expected.epoch,epoch:next.epoch,actorId:principal.userId,occurredAt:this.now().toISOString()};
    // Reconstructed bytes need their own immutable pointer; never point the new
    // head at the corrupt requested checkpoint or persist Yjs bytes in PostgreSQL.
    let checkpoint=manifest;
    if(fallbackEvent || !manifest.objectKey.startsWith(`whiteboards/tenants/`)){
      const contentHash=await checkpointHash(bytes),tenant=createHash('sha256').update(principal.orgId).digest('hex').slice(0,32);
      checkpoint={...manifest,objectKey:`whiteboards/tenants/${tenant}/boards/${boardId}/restores/${requestId}-${contentHash.slice(7)}.yjs`,contentHash,byteSize:bytes.byteLength};
      try{await this.objects.putOnce(checkpoint.objectKey,bytes,'application/vnd.yjs-update');}catch(error){if(!(error instanceof ObjectExistsError))throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');}
      await this.verifiedExisting(principal,checkpoint);
    }
    const committed=await this.metadata.commitRestore(principal,{boardId,checkpoint,snapshot:bytes,newEpoch:next.epoch,expectedEpoch:expected.epoch,expectedSeq:expected.seq,requestId,event,auditEvents:fallbackEvent?[fallbackEvent]:[]});
    return {...committed,event};
  }
}
