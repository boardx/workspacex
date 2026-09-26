import { ObjectExistsError, type ObjectStore } from '../artifact/ports';
import { checkpointHash, verifyCheckpoint, restoredHead } from '@repo/whiteboard-core';
import { WhiteboardCheckpointManifest, type WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';
import type { Principal } from '../../domain/principal';
import { createHash } from 'node:crypto';
export const WHITEBOARD_RECOVERY_SERVICE=Symbol('WhiteboardRecoveryService');

export type WhiteboardRecoveryFailure = 'NOT_FOUND' | 'FORBIDDEN' | 'STALE_HEAD' | 'CHECKPOINT_INVALID' | 'DEPENDENCY_UNAVAILABLE';
export class WhiteboardRecoveryError extends Error { constructor(readonly code: WhiteboardRecoveryFailure) { super(code); } }
export interface WhiteboardRecoveryHead { epoch: number; seq: number; role: 'owner' | 'editor' | 'viewer'; archived: boolean; }
export interface WhiteboardSnapshotSource { snapshot(principal: Principal, boardId: string, epoch: number, seq: number): Promise<Uint8Array>; }
export interface WhiteboardRecoveryMetadata {
  head(principal: Principal, boardId: string): Promise<WhiteboardRecoveryHead>;
  saveCheckpoint(principal: Principal, manifest: WhiteboardCheckpointManifest, requestId: string): Promise<{ manifest: WhiteboardCheckpointManifest; replayed: boolean }>;
  getCheckpoint(principal: Principal, boardId: string, checkpointId: string): Promise<WhiteboardCheckpointManifest | null>;
  /** Atomically CAS the old head, append BoardRestored, and point the new epoch at immutable bytes. */
  commitRestore(principal: Principal, input: { boardId: string; checkpoint: WhiteboardCheckpointManifest; newEpoch: number; expectedEpoch: number; expectedSeq: number; requestId: string; event: WhiteboardCollaborationEvent }): Promise<{ epoch: number; seq: 0; replayed: boolean }>;
}

/** Snapshot bytes only cross ObjectStore; repository receives immutable refs and metadata. */
export class WhiteboardRecoveryService {
  constructor(private readonly metadata: WhiteboardRecoveryMetadata, private readonly snapshots: WhiteboardSnapshotSource, private readonly objects: Pick<ObjectStore, 'putOnce' | 'get'>, private readonly now: () => Date = () => new Date()) {}
  private event(principal: Principal, manifest: WhiteboardCheckpointManifest): WhiteboardCollaborationEvent {
    return {type:'CheckpointCreated',eventId:manifest.checkpointId,operationId:manifest.checkpointId,boardId:manifest.boardId,checkpointId:manifest.checkpointId,epoch:manifest.epoch,seq:manifest.seq,actorId:principal.userId,occurredAt:manifest.createdAt};
  }
  private async verifiedExisting(principal: Principal, manifest: WhiteboardCheckpointManifest) {
    const expectedPrefix=`whiteboards/tenants/${createHash('sha256').update(principal.orgId).digest('hex').slice(0,32)}/boards/${manifest.boardId}/`;
    if (!manifest.objectKey.startsWith(expectedPrefix)) throw new WhiteboardRecoveryError('CHECKPOINT_INVALID');
    let bytes:Uint8Array|null; try { bytes=await this.objects.get(manifest.objectKey); } catch { throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE'); } if(!bytes) throw new WhiteboardRecoveryError('DEPENDENCY_UNAVAILABLE');
    try { await verifyCheckpoint(manifest,bytes); } catch { throw new WhiteboardRecoveryError('CHECKPOINT_INVALID'); }
  }
  async createCheckpoint(principal: Principal, boardId: string, requestId: string): Promise<{ manifest: WhiteboardCheckpointManifest; event: WhiteboardCollaborationEvent; replayed: boolean }> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    // Resolve an idempotent retry before sampling the moving board head. Otherwise the
    // same request after another edit hashes new bytes under the old immutable key.
    const [head, existing] = await Promise.all([this.metadata.head(principal, boardId), this.metadata.getCheckpoint(principal,boardId,requestId)]);
    if (head.role === 'viewer' || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
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
    try { saved=await this.metadata.saveCheckpoint(principal,manifest,requestId); }
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
  async restore(principal: Principal, boardId: string, checkpointId: string, requestId: string, expected: { epoch: number; seq: number }): Promise<{epoch:number;seq:0;replayed:boolean;event:WhiteboardCollaborationEvent}> {
    WhiteboardCheckpointManifest.shape.checkpointId.parse(requestId);
    const [head, manifest]=await Promise.all([this.metadata.head(principal,boardId),this.metadata.getCheckpoint(principal,boardId,checkpointId)]);
    if (!manifest) throw new WhiteboardRecoveryError('NOT_FOUND');
    if (head.role !== 'owner' || head.archived) throw new WhiteboardRecoveryError('FORBIDDEN');
    if (head.epoch!==expected.epoch || head.seq!==expected.seq) throw new WhiteboardRecoveryError('STALE_HEAD');
    await this.verifiedExisting(principal,manifest);
    const next=restoredHead(expected,manifest), event:WhiteboardCollaborationEvent={type:'BoardRestored',eventId:requestId,operationId:requestId,boardId,checkpointId,previousEpoch:expected.epoch,epoch:next.epoch,actorId:principal.userId,occurredAt:this.now().toISOString()};
    const committed=await this.metadata.commitRestore(principal,{boardId,checkpoint:manifest,newEpoch:next.epoch,expectedEpoch:expected.epoch,expectedSeq:expected.seq,requestId,event});
    return {...committed,event};
  }
}
