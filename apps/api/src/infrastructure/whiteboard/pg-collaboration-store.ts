import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardCollaborationError as Fault, type WhiteboardDeletionProof, type WhiteboardRestoreDeletionInput, type WhiteboardCollaborationStore, type WhiteboardCommandsInput, type WhiteboardUpdateInput, type WhiteboardUpdateAck, type WhiteboardPendingUpdate, type WhiteboardSyncState, type WhiteboardSyncHead, type WhiteboardUpdateValidator, type ValidatedWhiteboardUpdate } from '../../application/whiteboard/collaboration-ports';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { WhiteboardClientMessage, WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';

type DocumentRow = { epoch: number; seq: string; snapshot: Buffer };
type Access = { role: C.Board['role']; archived: boolean };
const HASH = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function validIds(principal: Principal, boardId: string, requestId?: string, epoch?: number): void {
  assertPrincipal(principal);
  if (!C.BoardId.safeParse(boardId).success || (requestId !== undefined && !C.CreateBoard.shape.requestId.safeParse(requestId).success)
    || (epoch !== undefined && (!Number.isSafeInteger(epoch) || epoch < 1))) throw new Fault('VALIDATION_FAILED');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
/**
 * Authorization is enforced by locked board ownership/member lookup, tenant RLS,
 * and fresh write-role/archive checks inside every committing transaction.
 * Caller must not wrap these methods in a larger transaction: returned ACK means
 * the DatabasePort's outer transaction has committed, not merely a savepoint.
 */
export class PgWhiteboardCollaborationStore implements WhiteboardCollaborationStore {
  constructor(private readonly db: DatabasePort, private readonly validator: WhiteboardUpdateValidator = new WorkerWhiteboardUpdateValidator(), private readonly acceptedUpdatesPerMinute = 120) {}
  private async access(session: TenantSession, p: Principal, boardId: string, write: boolean): Promise<Access> {
    const board = await session.query<{ owner_id: string; archived: boolean }>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`, [p.orgId, boardId]);
    const row = board.rows[0]; if (!row) throw new Fault('NOT_FOUND');
    // Separate statement after acquiring the lock sees a preceding revocation's commit.
    const members = row.owner_id === p.userId ? null : await session.query<{ role: string }>(`SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`, [p.orgId, boardId, p.userId]);
    const role = row.owner_id === p.userId ? 'owner' : members?.rows[0]?.role;
    if (!role) throw new Fault('NOT_FOUND');
    const parsed = C.BoardRole.safeParse(role); if (!parsed.success) throw new Fault('FORBIDDEN');
    if (write && parsed.data !== 'owner' && parsed.data !== 'editor') throw new Fault('FORBIDDEN');
    if (write && row.archived) throw new Fault('ARCHIVED');
    return { role: parsed.data, archived: row.archived };
  }
  private async document(session: TenantSession, p: Principal, boardId: string, forUpdate = false): Promise<DocumentRow> {
    await session.query(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING`, [p.orgId, boardId]);
    const result = await session.query<DocumentRow>(`SELECT epoch,seq,snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2${forUpdate ? ' FOR UPDATE' : ''}`, [p.orgId, boardId]);
    const row = result.rows[0]; if (!row) throw new Fault('NOT_FOUND'); return row;
  }
  async head(p: Principal, boardId: string): Promise<WhiteboardSyncHead> {
    validIds(p, boardId);
    return this.db.withTenant(p.orgId, async session => {
      const access = await this.access(session, p, boardId, false);
      const result = await session.query<{ epoch: number; seq: string }>(`SELECT epoch,seq FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId]);
      const row = result.rows[0];
      return { ...access, epoch: row?.epoch ?? 1, seq: Number(row?.seq ?? 0) };
    });
  }
  async load(p: Principal, boardId: string, vector?: Uint8Array): Promise<WhiteboardSyncState> {
    validIds(p, boardId);
    if (vector && (!(vector instanceof Uint8Array) || vector.byteLength > WHITEBOARD_VALIDATOR_LIMITS.vectorBytes)) throw new Fault('VALIDATION_FAILED');
    const stateVector = vector ? new Uint8Array(vector) : undefined;
    return this.db.withTenant(p.orgId, async session => {
      const access = await this.access(session, p, boardId, false), doc = await this.document(session, p, boardId);
      return { ...access, epoch: doc.epoch, seq: Number(doc.seq), update: await this.validator.diff(doc.snapshot, stateVector) };
    });
  }
  async append(p: Principal, boardId: string, input: WhiteboardUpdateInput): Promise<WhiteboardUpdateAck> {
    validIds(p, boardId, input.updateId, input.epoch);
    if (!(input.update instanceof Uint8Array) || input.update.byteLength < 1 || input.update.byteLength > WHITEBOARD_UPDATE_LIMITS.bytes) throw new Fault('VALIDATION_FAILED');
    const update = new Uint8Array(input.update);
    return this.commit(p, boardId, input.epoch, input.updateId, input.gestureId, HASH(Buffer.concat([Buffer.from(`update:${input.gestureId}:`), Buffer.from(update)])), snapshot => this.validator.validate(snapshot, update));
  }
  async restoreDeletion(p:Principal,boardId:string,input:WhiteboardRestoreDeletionInput):Promise<WhiteboardUpdateAck>{
    validIds(p,boardId,input.updateId,input.epoch);
    const parsed=WhiteboardClientMessage.safeParse({type:'restore-deletion',...input});
    if(!parsed.success)throw new Fault('VALIDATION_FAILED');
    const hash=HASH(`restore-deletion:${JSON.stringify(canonical(input))}`);
    return this.db.withTenant(p.orgId,async session=>{
      await this.access(session,p,boardId,true);const head=await this.document(session,p,boardId,true);
      if(head.epoch!==input.epoch)throw new Fault('STALE_EPOCH');
      const result=await session.query<{proof:WhiteboardDeletionProof[];changes:import('../../application/whiteboard/collaboration-ports').WhiteboardDeletionChange[];comments:Array<{id:string;status:string;revision:number}>;restored_update_id:string|null}>(
        'SELECT proof,changes,comments,restored_update_id FROM whiteboard_deletion_receipts WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND delete_gesture_id=$5 FOR UPDATE',[p.orgId,boardId,input.epoch,p.userId,input.deleteGestureId]);
      const receipt=result.rows[0];if(!receipt)throw new Fault('FORBIDDEN');
      if(receipt.restored_update_id&&receipt.restored_update_id!==input.updateId)throw new Fault('IDEMPOTENCY_CONFLICT');
      if(JSON.stringify(receipt.proof.map(item=>item.id).sort())!==JSON.stringify([...input.objectIds].sort()))throw new Fault('FORBIDDEN');
      if(!this.validator.restoreDeletion)throw new Fault('VALIDATOR_UNAVAILABLE');
      if(!receipt.restored_update_id)for(const comment of receipt.comments){
        const current=await session.query<{status:string;revision:number}>('SELECT status,revision FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE',[p.orgId,boardId,comment.id]);
        if(current.rows[0]?.status!=='object-deleted'||Number(current.rows[0]?.revision)!==comment.revision+1)throw new Fault('COMMENT_CONFLICT');
      }
      const {durability:_,...ack}=await this.commitInTransaction(session,p,boardId,input.epoch,input.updateId,input.gestureId,hash,snapshot=>this.validator.restoreDeletion!(snapshot,receipt.proof,receipt.changes,input.inverseUpdate?new Uint8Array(Buffer.from(input.inverseUpdate,'base64')):undefined));
      if(!ack.replayed){
        for(const comment of receipt.comments)await session.query(`UPDATE whiteboard_comment_threads SET status=$4,revision=revision+1,payload=jsonb_set(jsonb_set(jsonb_set(payload,'{status}',to_jsonb($4::text)),'{revision}',to_jsonb(revision+1)),'{archivedAt}','null'::jsonb),updated_at=now() WHERE org_id=$1 AND board_id=$2 AND id=$3`,[p.orgId,boardId,comment.id,comment.status]);
        await session.query('UPDATE whiteboard_deletion_receipts SET restored_update_id=$6 WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND delete_gesture_id=$5',[p.orgId,boardId,input.epoch,p.userId,input.deleteGestureId,input.updateId]);
        const event={type:'ObjectDeletionUndone',eventId:randomUUID(),operationId:input.updateId,boardId,actorId:p.userId,objectIds:receipt.proof.map(item=>item.id),deleteGestureId:input.deleteGestureId,occurredAt:new Date().toISOString()};
        await session.query('INSERT INTO whiteboard_collaboration_events(org_id,board_id,event_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[p.orgId,boardId,event.eventId,p.userId,event.type,JSON.stringify(event)]);
      }
      return ack;
    });
  }
  async writeCommands(p: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardUpdateAck> {
    validIds(p, boardId, input.requestId, input.epoch);
    const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.writeCommandsInTransaction(session, p, boardId, input));
    return ack;
  }
  /** Uses the caller's tenant transaction; its result is provisional until that transaction commits. */
  async writeCommandsInTransaction(session: TenantSession, p: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardPendingUpdate> {
    validIds(p, boardId, input.requestId, input.epoch);
    if (Buffer.byteLength(JSON.stringify(input.commands)) > WHITEBOARD_VALIDATOR_LIMITS.commandBytes) throw new Fault('VALIDATION_FAILED');
    const parsed = WhiteboardCommandBatch.safeParse(input.commands); if (!parsed.success) throw new Fault('VALIDATION_FAILED');
    const commands = structuredClone(parsed.data);
    return this.commitInTransaction(session, p, boardId, input.epoch, input.requestId, input.requestId, HASH(`commands:${JSON.stringify(canonical(commands))}`), snapshot => this.validator.commands(snapshot, commands));
  }
  private async commit(p: Principal, boardId: string, epoch: number, updateId: string, gestureId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardUpdateAck> {
    const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.commitInTransaction(session, p, boardId, epoch, updateId, gestureId, hash, validate));
    return ack;
  }
  private async commitInTransaction(session: TenantSession, p: Principal, boardId: string, epoch: number, updateId: string, gestureId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardPendingUpdate> {
    await this.access(session, p, boardId, true);
    // Serialize writers at the canonical document row. Each field command is then
    // calculated from the latest committed Yjs snapshot, so concurrent commands
    // issued from the same browser-visible base merge instead of overwriting it.
    const doc = await this.document(session, p, boardId, true);
    if (doc.epoch !== epoch) throw new Fault('STALE_EPOCH');
    const previous = await session.query<{ seq: string; request_hash: string; update: Buffer }>(`SELECT seq,request_hash,update FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5`, [p.orgId, boardId, epoch, p.userId, updateId]);
    const replay = previous.rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT');
      return { durability: 'pending', epoch, seq: Number(replay.seq), updateId, gestureId, replayed: true, update: new Uint8Array(replay.update) };
    }
    const count = await session.query<{ count: string }>(`SELECT count(*)::text AS count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND created_at>clock_timestamp()-interval '1 minute'`, [p.orgId, boardId, p.userId]);
    if (Number(count.rows[0]?.count ?? 0) >= this.acceptedUpdatesPerMinute) throw new Fault('RATE_LIMITED');
    const accepted = await validate(doc.snapshot), seq = Number(doc.seq) + 1;
    if (!Number.isSafeInteger(seq) || accepted.snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || accepted.update.byteLength > WHITEBOARD_SYNC.persistedUpdateBytes) throw new Fault('VALIDATION_FAILED');
    await session.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [p.orgId, boardId, epoch, seq, p.userId, updateId, hash, Buffer.from(accepted.update)]);
    await session.query(`UPDATE whiteboard_documents SET seq=$3,snapshot=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, seq, Buffer.from(accepted.snapshot)]);
    const liveObjectIds=await this.validator.objectIds(accepted.snapshot);
    const orphaned=await session.query<{id:string;object_id:string;status:string;revision:number}>(`SELECT id,object_id,status,revision FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND status<>'object-deleted' AND NOT(object_id=ANY($3::text[])) FOR UPDATE`,[p.orgId,boardId,liveObjectIds]);
    if(orphaned.rows.length){
      const archivedAt=new Date().toISOString();
      await session.query(`UPDATE whiteboard_comment_threads SET status='object-deleted',revision=revision+1,payload=jsonb_set(jsonb_set(jsonb_set(payload,'{status}','"object-deleted"'::jsonb),'{revision}',to_jsonb(revision+1)),'{archivedAt}',to_jsonb($4::text)),updated_at=now() WHERE org_id=$1 AND board_id=$2 AND id=ANY($3::uuid[])`,[p.orgId,boardId,orphaned.rows.map(row=>row.id),archivedAt]);
      for(const objectId of new Set(orphaned.rows.map(row=>row.object_id))){const event={type:'ObjectCommentsArchived',eventId:randomUUID(),operationId:updateId,boardId,objectId,threadIds:orphaned.rows.filter(row=>row.object_id===objectId).map(row=>row.id),actorId:p.userId,occurredAt:archivedAt};await session.query(`INSERT INTO whiteboard_collaboration_events(org_id,board_id,event_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,boardId,event.eventId,p.userId,event.type,JSON.stringify(event)]);}
    }
    if(accepted.deletions?.length){
      const inserted=await session.query(`INSERT INTO whiteboard_deletion_receipts(org_id,board_id,epoch,actor_id,delete_gesture_id,delete_update_id,deletion_seq,proof,comments,changes) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) ON CONFLICT DO NOTHING RETURNING delete_update_id`,[p.orgId,boardId,epoch,p.userId,gestureId,updateId,seq,JSON.stringify(accepted.deletions),JSON.stringify(orphaned.rows.filter(row=>accepted.deletions!.some(proof=>proof.id===row.object_id)).map(row=>({id:row.id,status:row.status,revision:Number(row.revision)}))),JSON.stringify(accepted.deletionChanges??[])]);
      if(!inserted.rows.length)throw new Fault('IDEMPOTENCY_CONFLICT');
    }
    await session.query(`UPDATE whiteboards SET updated_at=now() WHERE org_id=$1 AND id=$2`, [p.orgId, boardId]);
    return { durability: 'pending', epoch, seq, updateId, gestureId, replayed: false, update: accepted.update };
  }
}
