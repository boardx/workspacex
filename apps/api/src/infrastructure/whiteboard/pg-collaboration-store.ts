import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardCollaborationError as Fault, type WhiteboardCollaborationStore, type WhiteboardCommandsInput, type WhiteboardUpdateInput, type WhiteboardUpdateAck, type WhiteboardPendingUpdate, type WhiteboardSyncState, type WhiteboardSyncHead, type WhiteboardUpdateValidator, type ValidatedWhiteboardUpdate } from '../../application/whiteboard/collaboration-ports';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { ObjectExistsError, type ObjectStore } from '../../application/artifact/ports';

type StoredBody = { object_key: string | null; content_hash: string | null; byte_size: string | null; snapshot: Buffer | null };
type DocumentRow = StoredBody & { epoch: number; seq: string };
type UpdateRow = { seq: string; request_hash: string; update: Buffer | null; update_object_key: string | null; update_hash: string | null; update_size: string | null };
type LegacyUpdateRow = UpdateRow & { epoch: number; actor_id: string; update_id: string };
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
  constructor(private readonly db: DatabasePort, private readonly validator: WhiteboardUpdateValidator = new WorkerWhiteboardUpdateValidator(), private readonly acceptedUpdatesPerMinute = 120,
    private readonly objects?: Pick<ObjectStore, 'putOnce' | 'get' | 'head'>) {}
  private objectPrefix(p: Principal, boardId: string): string {
    return `whiteboards/tenants/${HASH(p.orgId).slice(0,32)}/boards/${boardId}`;
  }
  private async readStored(p: Principal, boardId: string, body: StoredBody, update = false): Promise<Uint8Array> {
    const key = body.object_key;
    if (!key) {
      if (!body.snapshot) throw new Fault('INTEGRITY_FAILED');
      const legacy=new Uint8Array(body.snapshot),limit=update?WHITEBOARD_SYNC.persistedUpdateBytes:WHITEBOARD_SYNC.documentBytes;
      if(legacy.byteLength>limit)throw new Fault('INTEGRITY_FAILED');
      return legacy;
    }
    if (!this.objects || !key.startsWith(`${this.objectPrefix(p, boardId)}/`)
      || !body.content_hash || !/^[a-f0-9]{64}$/.test(body.content_hash)) throw new Fault('INTEGRITY_FAILED');
    let bytes: Uint8Array | null;
    try { bytes = await this.objects.get(key); }
    catch { throw new Fault('DEPENDENCY_UNAVAILABLE'); }
    if (!bytes) throw new Fault('INTEGRITY_FAILED');
    const expected = Number(body.byte_size);
    if (!Number.isSafeInteger(expected) || expected !== bytes.byteLength || HASH(bytes) !== body.content_hash
      || bytes.byteLength > (update ? WHITEBOARD_SYNC.persistedUpdateBytes : WHITEBOARD_SYNC.documentBytes)) throw new Fault('INTEGRITY_FAILED');
    return bytes;
  }
  private async writeStored(key: string, bytes: Uint8Array): Promise<{ key: string; hash: string; size: number }> {
    if (!this.objects) throw new Fault('DEPENDENCY_UNAVAILABLE');
    const hash = HASH(bytes), copy = new Uint8Array(bytes);
    try { await this.objects.putOnce(key, copy, 'application/vnd.yjs-update'); }
    catch (error) { if (!(error instanceof ObjectExistsError)) throw new Fault('DEPENDENCY_UNAVAILABLE'); }
    let readback: Uint8Array | null, head: { sizeBytes: number; mime: string } | null;
    try { [readback, head] = await Promise.all([this.objects.get(key), this.objects.head(key)]); }
    catch { throw new Fault('DEPENDENCY_UNAVAILABLE'); }
    if (!readback || !head || readback.byteLength !== copy.byteLength || head.sizeBytes !== copy.byteLength || HASH(readback) !== hash) throw new Fault('INTEGRITY_FAILED');
    return { key, hash, size: copy.byteLength };
  }
  private async documentBytes(session: TenantSession, p: Principal, boardId: string, body: DocumentRow): Promise<Uint8Array> {
    if (body.object_key) return this.readStored(p, boardId, body);
    if (!body.snapshot) throw new Fault('INTEGRITY_FAILED');
    const bytes = await this.readStored(p,boardId,body);
    if (!this.objects) return bytes;
    const digest = HASH(bytes), ref = await this.writeStored(`${this.objectPrefix(p, boardId)}/epochs/${body.epoch}/snapshots/${body.seq}-${digest}.yjs`, bytes);
    const migrated = await session.query<StoredBody>(`UPDATE whiteboard_documents SET snapshot=NULL,manifest_version=1,object_key=$4,content_hash=$5,byte_size=$6,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$7 AND object_key IS NULL AND snapshot=$8 RETURNING object_key,content_hash,byte_size::text,snapshot`, [p.orgId, boardId, body.epoch, ref.key, ref.hash, ref.size, body.seq, Buffer.from(bytes)]);
    if (migrated.rows[0]) return bytes;
    const winner = await session.query<StoredBody>(`SELECT object_key,content_hash,byte_size::text,snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$4`, [p.orgId, boardId, body.epoch, body.seq]);
    if (!winner.rows[0]) throw new Fault('INTEGRITY_FAILED');
    return this.readStored(p, boardId, winner.rows[0]);
  }
  private async updateBytes(session: TenantSession, p: Principal, boardId: string, epoch: number, actorId: string, updateId: string, body: UpdateRow): Promise<Uint8Array> {
    const stored = { object_key: body.update_object_key, content_hash: body.update_hash, byte_size: body.update_size, snapshot: body.update };
    if (body.update_object_key) return this.readStored(p, boardId, stored, true);
    if (!body.update) throw new Fault('INTEGRITY_FAILED');
    const bytes = await this.readStored(p,boardId,stored,true);
    if (!this.objects) return bytes;
    const digest = HASH(bytes), ref = await this.writeStored(`${this.objectPrefix(p, boardId)}/epochs/${epoch}/updates/${body.seq}-${digest}.yjs`, bytes);
    const migrated = await session.query<StoredBody>(`UPDATE whiteboard_updates SET update=NULL,update_object_key=$6,update_hash=$7,update_size=$8 WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5 AND update_object_key IS NULL AND update=$9 RETURNING update_object_key AS object_key,update_hash AS content_hash,update_size::text AS byte_size,update AS snapshot`, [p.orgId, boardId, epoch, actorId, updateId, ref.key, ref.hash, ref.size, Buffer.from(bytes)]);
    if (migrated.rows[0]) return bytes;
    const winner = await session.query<UpdateRow>(`SELECT seq,request_hash,update,update_object_key,update_hash,update_size::text FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5`, [p.orgId, boardId, epoch, actorId, updateId]);
    if (!winner.rows[0]) throw new Fault('INTEGRITY_FAILED');
    return this.readStored(p, boardId, { object_key: winner.rows[0].update_object_key, content_hash: winner.rows[0].update_hash, byte_size: winner.rows[0].update_size, snapshot: winner.rows[0].update }, true);
  }
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
    const result = await session.query<DocumentRow>(`SELECT epoch,seq,snapshot,object_key,content_hash,byte_size::text FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2${forUpdate ? ' FOR UPDATE' : ''}`, [p.orgId, boardId]);
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
    return this.db.withTenant(p.orgId, session => this.loadInTransaction(session,p,boardId,stateVector));
  }
  async loadInTransaction(session:TenantSession,p:Principal,boardId:string,stateVector?:Uint8Array):Promise<WhiteboardSyncState> {
    validIds(p,boardId);
    const access=await this.access(session,p,boardId,false),doc=await this.document(session,p,boardId);
    const snapshot=await this.documentBytes(session,p,boardId,doc);
    return {...access,epoch:doc.epoch,seq:Number(doc.seq),update:await this.validator.diff(snapshot,stateVector)};
  }

  /** Tenant-scoped bounded worker hook for rows that may never be replayed naturally. */
  async backfillLegacyBoard(p: Principal, boardId: string, maxRows = 100): Promise<{ migrated: number; remaining: number }> {
    validIds(p,boardId);if(!this.objects)throw new Fault('DEPENDENCY_UNAVAILABLE');if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000)throw new Fault('VALIDATION_FAILED');
    return this.db.withTenant(p.orgId,async session=>{
      await this.access(session,p,boardId,false);
      const rows=await session.query<LegacyUpdateRow>(`SELECT epoch,seq::text,actor_id,update_id,request_hash,update,update_object_key,update_hash,update_size::text FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND update IS NOT NULL ORDER BY epoch,seq LIMIT $3`,[p.orgId,boardId,maxRows]);
      for(const row of rows.rows)await this.updateBytes(session,p,boardId,row.epoch,row.actor_id,row.update_id,row);
      const pending=await session.query<{count:string}>(`SELECT count(*)::text AS count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND update IS NOT NULL`,[p.orgId,boardId]);
      return{migrated:rows.rows.length,remaining:Number(pending.rows[0]?.count??0)};
    });
  }
  async append(p: Principal, boardId: string, input: WhiteboardUpdateInput): Promise<WhiteboardUpdateAck> {
    validIds(p, boardId, input.updateId, input.epoch);
    if (!(input.update instanceof Uint8Array) || input.update.byteLength < 1 || input.update.byteLength > WHITEBOARD_UPDATE_LIMITS.bytes) throw new Fault('VALIDATION_FAILED');
    const update = new Uint8Array(input.update);
    return this.commit(p, boardId, input.epoch, input.updateId, input.gestureId, HASH(Buffer.concat([Buffer.from(`update:${input.gestureId}:`), Buffer.from(update)])), snapshot => this.validator.validate(snapshot, update),HASH(Buffer.concat([Buffer.from('update:'),Buffer.from(update)])));
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
    return this.commitInTransaction(session, p, boardId, input.epoch, input.requestId, input.requestId, HASH(`commands:${JSON.stringify(canonical(commands))}`), snapshot => this.validator.commands(snapshot, commands),undefined,input.actorId);
  }
  async compensateInTransaction(session:TenantSession,p:Principal,boardId:string,input:{epoch:number;requestId:string;actorId:string;before:Uint8Array}):Promise<WhiteboardPendingUpdate>{
    validIds(p,boardId,input.requestId,input.epoch);
    if(!this.validator.compensate)throw new Fault('VALIDATOR_UNAVAILABLE');
    return this.commitInTransaction(session,p,boardId,input.epoch,input.requestId,input.requestId,HASH(`operation-compensation:${HASH(input.before)}`),snapshot=>this.validator.compensate!(snapshot,input.before),undefined,input.actorId);
  }
  private async commit(p: Principal, boardId: string, epoch: number, updateId: string, gestureId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>, legacyHash?:string): Promise<WhiteboardUpdateAck> {
    const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.commitInTransaction(session, p, boardId, epoch, updateId, gestureId, hash, validate, legacyHash));
    return ack;
  }
  private async commitInTransaction(session: TenantSession, p: Principal, boardId: string, epoch: number, updateId: string, gestureId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>, legacyHash?:string, attributedActorId = p.userId): Promise<WhiteboardPendingUpdate> {
    await this.access(session, p, boardId, true);
    // Serialize writers at the canonical document row. Each field command is then
    // calculated from the latest committed Yjs snapshot, so concurrent commands
    // issued from the same browser-visible base merge instead of overwriting it.
    const doc = await this.document(session, p, boardId, true);
    if (doc.epoch !== epoch) throw new Fault('STALE_EPOCH');
    const previous = await session.query<UpdateRow>(`SELECT seq,request_hash,update,update_object_key,update_hash,update_size::text FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5`, [p.orgId, boardId, epoch, attributedActorId, updateId]);
    const replay = previous.rows[0];
    if (replay) {
      if (replay.request_hash !== hash && replay.request_hash !== legacyHash) throw new Fault('IDEMPOTENCY_CONFLICT');
      const replayBytes = await this.updateBytes(session, p, boardId, epoch, attributedActorId, updateId, replay);
      return { durability: 'pending', epoch, seq: Number(replay.seq), updateId, gestureId, replayed: true, update: replayBytes };
    }
    const count = await session.query<{ count: string }>(`SELECT count(*)::text AS count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND created_at>clock_timestamp()-interval '1 minute'`, [p.orgId, boardId, attributedActorId]);
    if (Number(count.rows[0]?.count ?? 0) >= this.acceptedUpdatesPerMinute) throw new Fault('RATE_LIMITED');
    if (!this.objects) throw new Fault('DEPENDENCY_UNAVAILABLE');
    const current = await this.documentBytes(session, p, boardId, doc), accepted = await validate(current), seq = Number(doc.seq) + 1;
    if (!Number.isSafeInteger(seq) || accepted.snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || accepted.update.byteLength > WHITEBOARD_SYNC.persistedUpdateBytes) throw new Fault('VALIDATION_FAILED');
    const prefix=this.objectPrefix(p,boardId), snapshotHash=HASH(accepted.snapshot), updateHash=HASH(accepted.update);
    const [snapshotRef,updateRef]=await Promise.all([
      this.writeStored(`${prefix}/epochs/${epoch}/snapshots/${seq}-${snapshotHash}.yjs`,accepted.snapshot),
      this.writeStored(`${prefix}/epochs/${epoch}/updates/${seq}-${updateHash}.yjs`,accepted.update),
    ]);
    await session.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update,update_object_key,update_hash,update_size) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10)`, [p.orgId, boardId, epoch, seq, attributedActorId, updateId, hash, updateRef.key, updateRef.hash, updateRef.size]);
    await session.query(`UPDATE whiteboard_documents SET seq=$3,snapshot=NULL,manifest_version=1,object_key=$4,content_hash=$5,byte_size=$6,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, seq, snapshotRef.key, snapshotRef.hash, snapshotRef.size]);
    const liveObjectIds=await this.validator.objectIds(accepted.snapshot);
    const orphaned=await session.query<{id:string;object_id:string}>(`SELECT id,object_id FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND status<>'object-deleted' AND NOT(object_id=ANY($3::text[])) FOR UPDATE`,[p.orgId,boardId,liveObjectIds]);
    if(orphaned.rows.length){
      const archivedAt=new Date().toISOString();
      await session.query(`UPDATE whiteboard_comment_threads SET status='object-deleted',revision=revision+1,payload=jsonb_set(jsonb_set(jsonb_set(payload,'{status}','"object-deleted"'::jsonb),'{revision}',to_jsonb(revision+1)),'{archivedAt}',to_jsonb($4::text)),updated_at=now() WHERE org_id=$1 AND board_id=$2 AND id=ANY($3::uuid[])`,[p.orgId,boardId,orphaned.rows.map(row=>row.id),archivedAt]);
      for(const objectId of new Set(orphaned.rows.map(row=>row.object_id))){const event={type:'ObjectCommentsArchived',eventId:randomUUID(),operationId:updateId,boardId,objectId,threadIds:orphaned.rows.filter(row=>row.object_id===objectId).map(row=>row.id),actorId:p.userId,occurredAt:archivedAt};await session.query(`INSERT INTO whiteboard_collaboration_events(org_id,board_id,event_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,boardId,event.eventId,p.userId,event.type,JSON.stringify(event)]);}
    }
    await session.query(`UPDATE whiteboards SET updated_at=now() WHERE org_id=$1 AND id=$2`, [p.orgId, boardId]);
    return { durability: 'pending', epoch, seq, updateId, gestureId, replayed: false, update: accepted.update };
  }
}
