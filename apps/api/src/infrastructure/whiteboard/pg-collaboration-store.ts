import { createHash } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardCollaborationError as Fault, type WhiteboardCollaborationStore, type WhiteboardCommandsInput, type WhiteboardUpdateInput, type WhiteboardUpdateAck, type WhiteboardPendingUpdate, type WhiteboardSyncState, type WhiteboardSyncHead, type WhiteboardUpdateValidator, type ValidatedWhiteboardUpdate } from '../../application/whiteboard/collaboration-ports';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { BoardBlobCodec, BoardBlobStore, EncodedBoardBlob } from '../../application/whiteboard/blob-ports';
import { boardBlobKey, sha256 } from '../../domain/whiteboard/blob-identity';
import { decodeBoardContentManifest, encodeBoardContentManifest, type BoardContentManifest } from '../../domain/whiteboard/content-manifest';

type DocumentRow = { epoch: number; seq: string; snapshot: Buffer | null; head: ContentHead; fresh: boolean };
type ContentHead = {
  epoch: number; head_seq: string; storage_kind: 'legacy_pg' | 'dual_write' | 'blob_primary'; manifest_key: string | null;
  manifest_digest: string | null; manifest_size_bytes: string | null; tenant_key_version: number | null; fencing_token: string;
};
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
  constructor(
    private readonly db: DatabasePort,
    private readonly validator: WhiteboardUpdateValidator = new WorkerWhiteboardUpdateValidator(),
    private readonly acceptedUpdatesPerMinute = 120,
    private readonly blobs?: BoardBlobStore,
    private readonly codec?: BoardBlobCodec,
    private readonly tenantKeyVersion = 1,
  ) {
    if ((blobs === undefined) !== (codec === undefined)) throw new Error('Board blob store and codec must be configured together');
    if (!Number.isSafeInteger(tenantKeyVersion) || tenantKeyVersion < 1) throw new Error('Invalid Board tenant key version');
  }
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
    const inserted = await session.query<{ board_id: string }>(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING RETURNING board_id`, [p.orgId, boardId]);
    await session.query(`INSERT INTO whiteboard_content_heads(org_id,board_id,epoch,head_seq,checkpoint_seq) SELECT org_id,board_id,epoch,seq,seq FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 ON CONFLICT(org_id,board_id) DO NOTHING`, [p.orgId, boardId]);
    const result = await session.query<{ epoch: number; seq: string; snapshot: Buffer | null; head_epoch: number; head_seq: string; storage_kind: ContentHead['storage_kind']; manifest_key: string | null; manifest_digest: string | null; manifest_size_bytes: string | null; tenant_key_version: number | null; fencing_token: string }>(`SELECT d.epoch,d.seq,d.snapshot,h.epoch AS head_epoch,h.head_seq,h.storage_kind,h.manifest_key,h.manifest_digest,h.manifest_size_bytes,h.tenant_key_version,h.fencing_token FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [p.orgId, boardId]);
    const row = result.rows[0]; if (!row) throw new Fault('NOT_FOUND');
    return { epoch: row.epoch, seq: row.seq, snapshot: row.snapshot, fresh: inserted.rows.length === 1, head: { epoch: row.head_epoch, head_seq: row.head_seq, storage_kind: row.storage_kind, manifest_key: row.manifest_key, manifest_digest: row.manifest_digest, manifest_size_bytes: row.manifest_size_bytes, tenant_key_version: row.tenant_key_version, fencing_token: row.fencing_token } };
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
      if (doc.fresh && this.blobs && this.codec) await this.activateNewBoard(session, p, boardId, doc);
      const snapshot = await this.snapshot(p, boardId, doc);
      return { ...access, epoch: doc.epoch, seq: Number(doc.seq), update: await this.validator.diff(snapshot, stateVector) };
    });
  }
  async append(p: Principal, boardId: string, input: WhiteboardUpdateInput): Promise<WhiteboardUpdateAck> {
    validIds(p, boardId, input.updateId, input.epoch);
    if (!(input.update instanceof Uint8Array) || input.update.byteLength < 1 || input.update.byteLength > WHITEBOARD_UPDATE_LIMITS.bytes) throw new Fault('VALIDATION_FAILED');
    const update = new Uint8Array(input.update);
    return this.commit(p, boardId, input.epoch, input.updateId, HASH(Buffer.concat([Buffer.from('update:'), Buffer.from(update)])), snapshot => this.validator.validate(snapshot, update));
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
    return this.commitInTransaction(session, p, boardId, input.epoch, input.requestId, HASH(`commands:${JSON.stringify(canonical(commands))}`), snapshot => this.validator.commands(snapshot, commands));
  }
  private async commit(p: Principal, boardId: string, epoch: number, updateId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardUpdateAck> {
    const { durability: _pending, ...ack } = await this.db.withTenant(p.orgId, session => this.commitInTransaction(session, p, boardId, epoch, updateId, hash, validate));
    return ack;
  }
  private async commitInTransaction(session: TenantSession, p: Principal, boardId: string, epoch: number, updateId: string, hash: string, validate: (snapshot: Uint8Array) => Promise<ValidatedWhiteboardUpdate>): Promise<WhiteboardPendingUpdate> {
    await this.access(session, p, boardId, true);
    const doc = await this.document(session, p, boardId);
    if (doc.epoch !== epoch) throw new Fault('STALE_EPOCH');
    const previous = await session.query<{ seq: string; request_hash: string }>(`SELECT seq,request_hash FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND actor_id=$4 AND update_id=$5`, [p.orgId, boardId, epoch, p.userId, updateId]);
    const replay = previous.rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT');
      return { durability: 'pending', epoch, seq: Number(replay.seq), updateId, replayed: true, update: new Uint8Array() };
    }
    const count = await session.query<{ count: string }>(`SELECT count(*)::text AS count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND created_at>clock_timestamp()-interval '1 minute'`, [p.orgId, boardId, p.userId]);
    if (Number(count.rows[0]?.count ?? 0) >= this.acceptedUpdatesPerMinute) throw new Fault('RATE_LIMITED');
    const snapshot = await this.snapshot(p, boardId, doc);
    const accepted = await validate(snapshot), seq = Number(doc.seq) + 1;
    if (!Number.isSafeInteger(seq) || accepted.snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || accepted.update.byteLength > 1048576) throw new Fault('VALIDATION_FAILED');
    const published = this.blobs && this.codec ? await this.publish(p, boardId, epoch, seq, accepted.snapshot, doc.head.manifest_digest) : null;
    await session.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [p.orgId, boardId, epoch, seq, p.userId, updateId, hash, published ? null : Buffer.from(accepted.update)]);
    await session.query(`UPDATE whiteboard_documents SET seq=$3,snapshot=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, seq, published ? null : Buffer.from(accepted.snapshot)]);
    if (published) {
      const changed = await session.query<{ fencing_token: string }>(`UPDATE whiteboard_content_heads SET epoch=$3,head_seq=$4,checkpoint_seq=$4,storage_kind='blob_primary',manifest_key=$5,manifest_digest=$6,manifest_size_bytes=$7,tenant_key_version=$8,schema_version=1,protocol_version=1,content_state='active',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND head_seq=$9 AND fencing_token=$10 RETURNING fencing_token`, [p.orgId, boardId, epoch, seq, published.key, published.digest, published.sizeBytes, this.tenantKeyVersion, Number(doc.head.head_seq), Number(doc.head.fencing_token)]);
      if (!changed.rows[0]) throw new Error('WHITEBOARD_CONTENT_HEAD_CAS_CONFLICT');
    } else {
      await session.query(`UPDATE whiteboard_content_heads SET epoch=$3,head_seq=$4,checkpoint_seq=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, epoch, seq]);
    }
    await session.query(`UPDATE whiteboards SET updated_at=now() WHERE org_id=$1 AND id=$2`, [p.orgId, boardId]);
    return { durability: 'pending', epoch, seq, updateId, replayed: false, update: accepted.update };
  }

  private async snapshot(p: Principal, boardId: string, doc: DocumentRow): Promise<Uint8Array> {
    if (doc.head.storage_kind === 'legacy_pg') {
      if (!doc.snapshot) throw new Error('Legacy Board snapshot is missing');
      return new Uint8Array(doc.snapshot);
    }
    if (!this.blobs || !this.codec || !doc.head.manifest_key || !doc.head.manifest_digest || !doc.head.manifest_size_bytes || !doc.head.tenant_key_version) {
      throw new Error('Board blob runtime is unavailable');
    }
    const manifestBytes = await this.blobs.getVerified({ tenantId: p.orgId, key: doc.head.manifest_key, expectedCipherDigest: doc.head.manifest_digest, expectedSizeBytes: Number(doc.head.manifest_size_bytes) });
    const manifest = decodeBoardContentManifest(manifestBytes);
    if (manifest.boardId !== boardId || manifest.epoch !== doc.epoch || manifest.headSeq !== Number(doc.seq) || manifest.tenantKeyVersion !== doc.head.tenant_key_version) throw new Error('Board manifest head mismatch');
    const encrypted = await this.blobs.getVerified({ tenantId: p.orgId, key: manifest.checkpoint.key, expectedCipherDigest: manifest.checkpoint.cipherDigest, expectedSizeBytes: manifest.checkpoint.sizeBytes });
    return this.codec.decrypt({ ...manifest.checkpoint, ciphertext: encrypted, tenantId: p.orgId, tenantKeyVersion: manifest.tenantKeyVersion, expectedPlainDigest: manifest.checkpoint.plainDigest });
  }

  private async activateNewBoard(session: TenantSession, p: Principal, boardId: string, doc: DocumentRow): Promise<void> {
    if (!doc.snapshot) throw new Error('New Board snapshot is missing');
    const published = await this.publish(p, boardId, doc.epoch, Number(doc.seq), doc.snapshot, null);
    const changed = await session.query<{ fencing_token: string }>(`UPDATE whiteboard_content_heads SET storage_kind='blob_primary',manifest_key=$3,manifest_digest=$4,manifest_size_bytes=$5,tenant_key_version=$6,schema_version=1,protocol_version=1,content_state='active',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND head_seq=0 AND fencing_token=0 RETURNING fencing_token`, [p.orgId, boardId, published.key, published.digest, published.sizeBytes, this.tenantKeyVersion]);
    if (!changed.rows[0]) throw new Error('WHITEBOARD_CONTENT_HEAD_CAS_CONFLICT');
    await session.query(`UPDATE whiteboard_documents SET snapshot=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId]);
    doc.snapshot = null; doc.fresh = false;
    doc.head = { ...doc.head, storage_kind: 'blob_primary', manifest_key: published.key, manifest_digest: published.digest, manifest_size_bytes: String(published.sizeBytes), tenant_key_version: this.tenantKeyVersion, fencing_token: changed.rows[0].fencing_token };
  }

  private async publish(p: Principal, boardId: string, epoch: number, seq: number, snapshot: Uint8Array, parentManifestDigest: string | null): Promise<{ key: string; digest: string; sizeBytes: number }> {
    const checkpoint = await this.codec!.encrypt({ tenantId: p.orgId, tenantKeyVersion: this.tenantKeyVersion, plaintext: snapshot });
    const checkpointKey = boardBlobKey({ tenantId: p.orgId, boardId, kind: 'checkpoint', cipherDigest: checkpoint.cipherDigest });
    await this.putAndVerify(p.orgId, checkpointKey, checkpoint);
    const manifest: BoardContentManifest = {
      manifestVersion: 1, boardId, epoch, headSeq: seq, schemaVersion: 1,
      checkpoint: { key: checkpointKey, plainDigest: checkpoint.plainDigest, cipherDigest: checkpoint.cipherDigest, sizeBytes: checkpoint.sizeBytes, throughSeq: seq },
      tail: [], parentManifestDigest, tenantKeyVersion: this.tenantKeyVersion, createdAt: new Date().toISOString(),
    };
    const bytes = encodeBoardContentManifest(manifest), digest = sha256(bytes);
    const key = boardBlobKey({ tenantId: p.orgId, boardId, kind: 'manifest', cipherDigest: digest });
    await this.blobs!.putImmutable({ tenantId: p.orgId, key, ciphertext: bytes, cipherDigest: digest, sizeBytes: bytes.byteLength });
    const readback = await this.blobs!.getVerified({ tenantId: p.orgId, key, expectedCipherDigest: digest, expectedSizeBytes: bytes.byteLength });
    const decoded = decodeBoardContentManifest(readback);
    if (decoded.boardId !== boardId || decoded.epoch !== epoch || decoded.headSeq !== seq || sha256(readback) !== digest) throw new Error('Board manifest read-back mismatch');
    return { key, digest, sizeBytes: bytes.byteLength };
  }

  private async putAndVerify(tenantId: string, key: string, blob: EncodedBoardBlob): Promise<void> {
    await this.blobs!.putImmutable({ tenantId, key, ciphertext: blob.ciphertext, cipherDigest: blob.cipherDigest, sizeBytes: blob.sizeBytes });
    const readback = await this.blobs!.getVerified({ tenantId, key, expectedCipherDigest: blob.cipherDigest, expectedSizeBytes: blob.sizeBytes });
    await this.codec!.decrypt({ ...blob, ciphertext: readback, tenantId, expectedPlainDigest: blob.plainDigest });
  }
}
