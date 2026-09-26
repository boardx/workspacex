import { createHash } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardCollaborationError as Fault, type WhiteboardCollaborationStore, type WhiteboardCommandsInput, type WhiteboardUpdateInput, type WhiteboardUpdateAck, type WhiteboardPendingUpdate, type WhiteboardSyncState, type WhiteboardSyncHead, type WhiteboardUpdateValidator, type ValidatedWhiteboardUpdate } from '../../application/whiteboard/collaboration-ports';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { WhiteboardObservability } from '../../application/whiteboard/observability';
import { WHITEBOARD_SCALE_POLICY } from '../../domain/whiteboard-scale-policy';
import { ProcessWhiteboardObservability } from './observability';

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
  constructor(private readonly db: DatabasePort,
    private readonly validator: WhiteboardUpdateValidator = new WorkerWhiteboardUpdateValidator(),
    private readonly acceptedUpdatesPerMinute = 120,
    private readonly metrics: WhiteboardObservability = new ProcessWhiteboardObservability()) {}
  private async access(session: TenantSession, p: Principal, boardId: string, write: boolean): Promise<Access> {
    const board = await session.query<{ owner_id: string; archived: boolean }>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`, [p.orgId, boardId]);
    const row = board.rows[0]; if (!row) throw new Fault('NOT_FOUND');
    // Separate statement after acquiring the lock sees a preceding revocation's commit.
    const members = row.owner_id === p.userId ? null : await session.query<{ role: string }>(`SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`, [p.orgId, boardId, p.userId]);
    const role = row.owner_id === p.userId ? 'owner' : members?.rows[0]?.role;
    if (!role) throw new Fault('NOT_FOUND');
    const parsed = C.BoardRole.safeParse(role); if (!parsed.success) throw new Fault('FORBIDDEN');
    if (write && parsed.data === 'viewer') throw new Fault('FORBIDDEN');
    if (write && row.archived) throw new Fault('ARCHIVED');
    return { role: parsed.data, archived: row.archived };
  }
  private async document(session: TenantSession, p: Principal, boardId: string): Promise<DocumentRow> {
    await session.query(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING`, [p.orgId, boardId]);
    const result = await session.query<DocumentRow>(`SELECT epoch,seq,snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId]);
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
    return this.commit(p, boardId, input.epoch, input.updateId, HASH(Buffer.concat([Buffer.from('update:'), Buffer.from(update)])), snapshot => this.validator.validate(snapshot, update, p.userId));
  }
  async writeCommands(p: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardUpdateAck> {
    validIds(p, boardId, input.requestId, input.epoch);
    const started = performance.now();
    try {
      const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.writeCommandsInTransaction(session, p, boardId, input));
      this.metrics.persisted('accepted', performance.now() - started); return ack;
    } catch (error) {
      this.metrics.persisted(error instanceof Fault ? 'rejected' : 'error', performance.now() - started);
      throw error;
    }
  }
  /** Uses the caller's tenant transaction; its result is provisional until that transaction commits. */
  async writeCommandsInTransaction(session: TenantSession, p: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardPendingUpdate> {
    validIds(p, boardId, input.requestId, input.epoch);
    if (Buffer.byteLength(JSON.stringify(input.commands)) > WHITEBOARD_VALIDATOR_LIMITS.commandBytes) throw new Fault('VALIDATION_FAILED');
    const parsed = WhiteboardCommandBatch.safeParse(input.commands); if (!parsed.success) throw new Fault('VALIDATION_FAILED');
    const commands = structuredClone(parsed.data);
    return this.commitInTransaction(session, p, boardId, input.epoch, input.requestId, HASH(`commands:${JSON.stringify(canonical(commands))}`), snapshot => this.validator.commands(snapshot, commands));
  }
  private async commit(p: Principal, boardId: string, epoch: number, updateId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardUpdateAck> {
    const started = performance.now();
    try {
      const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.commitInTransaction(session, p, boardId, epoch, updateId, hash, validate));
      this.metrics.persisted('accepted', performance.now() - started); return ack;
    } catch (error) {
      this.metrics.persisted(error instanceof Fault ? 'rejected' : 'error', performance.now() - started);
      throw error;
    }
  }
  private async commitInTransaction(session: TenantSession, p: Principal, boardId: string, epoch: number, updateId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardPendingUpdate> {
    await this.access(session, p, boardId, true);
    const doc = await this.document(session, p, boardId);
    if (doc.epoch !== epoch) throw new Fault('STALE_EPOCH');
    const previous = await session.query<{ seq: string; request_hash: string; update: Buffer }>(`SELECT seq,request_hash,update FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5`, [p.orgId, boardId, epoch, p.userId, updateId]);
    const replay = previous.rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT');
      return { durability: 'pending', epoch, seq: Number(replay.seq), updateId, replayed: true, update: new Uint8Array(replay.update) };
    }
    const count = await session.query<{ count: string }>(`SELECT count(*)::text AS count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND created_at>clock_timestamp()-interval '1 minute'`, [p.orgId, boardId, p.userId]);
    if (Number(count.rows[0]?.count ?? 0) >= this.acceptedUpdatesPerMinute) throw new Fault('RATE_LIMITED');
    const accepted = await validate(doc.snapshot), seq = Number(doc.seq) + 1;
    if (!Number.isSafeInteger(seq) || accepted.snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || accepted.update.byteLength > WHITEBOARD_SCALE_POLICY.update.acceptedBytes) throw new Fault('VALIDATION_FAILED');
    await session.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [p.orgId, boardId, epoch, seq, p.userId, updateId, hash, Buffer.from(accepted.update)]);
    await session.query(`UPDATE whiteboard_documents SET seq=$3,snapshot=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, seq, Buffer.from(accepted.snapshot)]);
    await session.query(`UPDATE whiteboards SET updated_at=now() WHERE org_id=$1 AND id=$2`, [p.orgId, boardId]);
    return { durability: 'pending', epoch, seq, updateId, replayed: false, update: accepted.update };
  }
}
