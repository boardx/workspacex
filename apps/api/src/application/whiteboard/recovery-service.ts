import { ObjectExistsError, type ObjectStore } from '../artifact/ports';
import { checkpointHash, verifyCheckpoint, restoredHead } from '@repo/whiteboard-core';
import { WhiteboardCheckpointManifest, type WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';
import type { Principal } from '../../domain/principal';

export type WhiteboardRecoveryFailure = 'NOT_FOUND' | 'FORBIDDEN' | 'STALE_HEAD' | 'CHECKPOINT_INVALID' | 'DEPENDENCY_UNAVAILABLE';
export class WhiteboardRecoveryError extends Error { constructor(readonly code: WhiteboardRecoveryFailure) { super(code); } }
export interface WhiteboardRecoveryHead { epoch: number; seq: number; role: 'owner' | 'editor' | 'viewer'; archived: boolean; }
export interface WhiteboardSnapshotSource { snapshot(principal: Principal, boardId: string, epoch: number, seq: number): Promise<Uint8Array>; }
export interface WhiteboardRecoveryMetadata {
  head(principal: Principal, boardId: string): Promise<WhiteboardRecoveryHead>;
  saveCheckpoint(principal: Principal, manifest: WhiteboardCheckpointManifest, requestId: string, event: WhiteboardCollaborationEvent): Promise<{ manifest: WhiteboardCheckpointManifest; replayed: boolean }>;
  getCheckpoint(principal: Principal, boardId: string, checkpointId: string): Promise<WhiteboardCheckpointManifest | null>;
  findCheckpointRequest(principal: Principal, boardId: string, requestId: string): Promise<WhiteboardCheckpointManifest|null>;
  findRestore(principal: Principal, boardId: string, requestId: string): Promise<{epoch:number;seq:0;event:WhiteboardCollaborationEvent}|null>;
  /** Atomically CAS the old head, append BoardRestored, and point the new epoch at immutable bytes. */
  commitRestore(principal: Principal, input: { boardId: string; checkpoint: WhiteboardCheckpointManifest; snapshot: Uint8Array; newEpoch: number; expectedEpoch: number; expectedSeq: number; requestId: string; event: WhiteboardCollaborationEvent }): Promise<{ epoch: number; seq: 0; replayed: boolean }>;
}

/** Snapshot bytes only cross ObjectStore; repository receives immutable refs and metadata. */
export class WhiteboardRecoveryService {
  constructor(private readonly metadata: WhiteboardRecoveryMetadata, private readonly snapshots: WhiteboardSnapshotSource, private readonly objects: Pick<ObjectStore, 'putOnce' | 'get'>, private readonly now: () => Date = () => new Date()) {}
  async createCheckpoint(principal: Principal, boardId: string, requestId: string): Promise<{ manifest: WhiteboardCheckpointManifest; event: WhiteboardCollaborationEvent; replayed: boolean }> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    const head = await this.metadata.head(principal, boardId);
    if (head.role === 'viewer' || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
    const existing=await this.metadata.findCheckpointRequest(principal,boardId,requestId);
    if(existing) return {manifest:existing,replayed:true,event:{type:'CheckpointCreated',eventId:requestId,operationId:requestId,boardId,checkpointId:existing.checkpointId,epoch:existing.epoch,seq:existing.seq,actorId:existing.createdBy,occurredAt:existing.createdAt}};
    const snapshot=await this.snapshots.snapshot(principal,boardId,head.epoch,head.seq);
    const checkpointId=requestId, contentHash=await checkpointHash(snapshot);
    const manifest=WhiteboardCheckpointManifest.parse({checkpointId,boardId,version:1,epoch:head.epoch,seq:head.seq,
      objectKey:`whiteboards/${boardId}/checkpoints/${checkpointId}.yjs`,contentHash,byteSize:snapshot.byteLength,createdBy:principal.userId,createdAt:this.now().toISOString()});
    try { await this.objects.putOnce(manifest.objectKey, snapshot, 'application/vnd.yjs-update'); }
    catch(error) {
      if (!(error instanceof ObjectExistsError)) throw error;
      const existing=await this.objects.get(manifest.objectKey); if(!existing) throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');
      try { await verifyCheckpoint(manifest,existing); } catch { throw new WhiteboardRecoveryError('CHECKPOINT_INVALID'); }
    }
    const event:WhiteboardCollaborationEvent={type:'CheckpointCreated',eventId:requestId,operationId:requestId,boardId,checkpointId:manifest.checkpointId,epoch:manifest.epoch,seq:manifest.seq,actorId:principal.userId,occurredAt:manifest.createdAt};
    const saved=await this.metadata.saveCheckpoint(principal,manifest,requestId,event);
    return {manifest:saved.manifest,replayed:saved.replayed,event};
  }
  async restore(principal: Principal, boardId: string, checkpointId: string, requestId: string, expected: { epoch: number; seq: number }): Promise<{epoch:number;seq:0;replayed:boolean;event:WhiteboardCollaborationEvent}> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    const [head, manifest]=await Promise.all([this.metadata.head(principal,boardId),this.metadata.getCheckpoint(principal,boardId,checkpointId)]);
    if (!manifest) throw new WhiteboardRecoveryError('NOT_FOUND');
    if (head.role !== 'owner' || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
    const replay=await this.metadata.findRestore(principal,boardId,requestId);if(replay)return{...replay,replayed:true};
    if (head.epoch!==expected.epoch || head.seq!==expected.seq) throw new WhiteboardRecoveryError('STALE_HEAD');
    const bytes=await this.objects.get(manifest.objectKey); if(!bytes) throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');
    try { await verifyCheckpoint(manifest,bytes); } catch { throw new WhiteboardRecoveryError('CHECKPOINT_INVALID'); }
    const next=restoredHead(expected,manifest), event:WhiteboardCollaborationEvent={type:'BoardRestored',eventId:requestId,operationId:requestId,boardId,checkpointId,previousEpoch:expected.epoch,epoch:next.epoch,actorId:principal.userId,occurredAt:this.now().toISOString()};
    const committed=await this.metadata.commitRestore(principal,{boardId,checkpoint:manifest,snapshot:bytes,newEpoch:next.epoch,expectedEpoch:expected.epoch,expectedSeq:expected.seq,requestId,event});
    return {...committed,event};
  }
}
