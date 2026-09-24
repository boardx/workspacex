import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C, whiteboardHistory as H } from '@repo/contracts';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardCollaborationError as Fault, type WhiteboardCollaborationStore, type WhiteboardCommandsInput, type WhiteboardUpdateInput, type WhiteboardUpdateAck, type WhiteboardPendingUpdate, type WhiteboardSyncState, type WhiteboardSyncHead, type WhiteboardUpdateValidator, type ValidatedWhiteboardUpdate } from '../../application/whiteboard/collaboration-ports';
import { WorkerWhiteboardUpdateValidator, WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { BoardBlobError, type BoardBlobCodec, type BoardBlobStore, type EncodedBoardBlob } from '../../application/whiteboard/blob-ports';
import { boardBlobKey, sha256, type BoardBlobKind } from '../../domain/whiteboard/blob-identity';
import { decodeBoardContentManifest, encodeBoardContentManifest, type BoardContentManifest } from '../../domain/whiteboard/content-manifest';
import type { CompareCheckpointInput, CreateCheckpointInput, RestoreCheckpointInput } from '../../application/whiteboard/history-ports';
import { compareHistoryRecords, historyRecords, type HistoryRecord } from '../../domain/whiteboard/history-projection';

type DocumentRow = { epoch: number; seq: string; snapshot: Buffer | null; head: ContentHead; fresh: boolean };
type ContentHead = {
  epoch: number; head_seq: string; storage_kind: 'legacy_pg' | 'dual_write' | 'blob_primary'; manifest_key: string | null;
  manifest_digest: string | null; manifest_plain_digest: string | null; manifest_size_bytes: string | null; tenant_key_version: number | null;
  schema_version: number | null; protocol_version: number | null; fencing_token: string;
};
type Access = { role: C.Board['role']; archived: boolean };
type HistoryCheckpointRow = {
  checkpoint_id: string; board_id: string; epoch: number; seq: string; head_manifest_digest: string;
  blob_key: string; blob_version: number; cipher_sha256: string; content_sha256: string; size_bytes: string;
  object_count: number; actor_id: string; label: string; reason: string; retention_until: Date;
  retention_state: 'active' | 'pinned'; source_board_id: string | null; source_checkpoint_id: string | null; created_at: Date;
};
type HistoryRestoreRow = { restore_id: string; source_board_id: string; source_checkpoint_id: string; restored_board_id: string; restored_checkpoint_id: string; actor_id: string; reason: string; created_at: Date };
type HistoryBlobIntentRow = { intent_id: string; blob_role: 'history_checkpoint'|'restore_checkpoint'|'restore_manifest'; board_id: string; reference_board_id: string|null; reference_checkpoint_id: string|null;
  blob_key: string|null; blob_version: number|null; cipher_sha256: string|null; content_sha256: string|null; size_bytes: string|null; state: 'staging'|'referenced'|'deleted'; created_at: Date; updated_at: Date };
const historyCheckpointColumns = `checkpoint_id,board_id,epoch,seq,head_manifest_digest,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,
  object_count,actor_id,label,reason,retention_until,retention_state,source_board_id,source_checkpoint_id,created_at`;
export type WhiteboardHistorySource = { snapshot: Uint8Array; epoch: number; seq: number; headDigest: string; fencingToken: number };
export type PublishedBoardContent = {
  key: string; cipherDigest: string; plainDigest: string; sizeBytes: number;
  checkpoint: { key: string; cipherDigest: string; plainDigest: string; sizeBytes: number; tenantKeyVersion: number };
};
const CONTENT_SCHEMA_VERSION = 1, CONTENT_PROTOCOL_VERSION = 1;
const HASH = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function restoredBoardIdForRequest(orgId: string, actorId: string, sourceBoardId: string, checkpointId: string, requestId: string): string {
  const bytes = createHash('sha256')
    .update(`whiteboard-history-restore\0${orgId}\0${actorId}\0${sourceBoardId}\0${checkpointId}\0${requestId}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function assertHeadMatchesDocument(document: { epoch: number; seq: string }, head: { epoch: number; head_seq: string }): void {
  if (head.epoch !== document.epoch || Number(head.head_seq) !== Number(document.seq)) {
    throw new BoardBlobError('INTEGRITY_FAILED', 'Board content head does not match document metadata');
  }
}
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
function historyCheckpointView(row: HistoryCheckpointRow): H.Checkpoint {
  const retentionState = row.retention_state === 'pinned' ? 'pinned' : new Date(row.retention_until).getTime() <= Date.now() ? 'expired' : 'active';
  return H.Checkpoint.parse({ id: row.checkpoint_id, boardId: row.board_id, epoch: row.epoch, seq: Number(row.seq),
    headDigest: row.head_manifest_digest, contentDigest: row.content_sha256, byteLength: Number(row.size_bytes), objectCount: row.object_count,
    blobVersion: row.blob_version, createdAt: new Date(row.created_at).toISOString(), creatorId: row.actor_id, label: row.label,
    reason: row.reason, retentionUntil: new Date(row.retention_until).toISOString(), retentionState,
    sourceBoardId: row.source_board_id, sourceCheckpointId: row.source_checkpoint_id });
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
    const result = await session.query<{ epoch: number; seq: string; snapshot: Buffer | null; head_epoch: number; head_seq: string; storage_kind: ContentHead['storage_kind']; manifest_key: string | null; manifest_digest: string | null; manifest_plain_digest: string | null; manifest_size_bytes: string | null; tenant_key_version: number | null; schema_version: number | null; protocol_version: number | null; fencing_token: string }>(`SELECT d.epoch,d.seq,d.snapshot,h.epoch AS head_epoch,h.head_seq,h.storage_kind,h.manifest_key,h.manifest_digest,h.manifest_plain_digest,h.manifest_size_bytes,h.tenant_key_version,h.schema_version,h.protocol_version,h.fencing_token FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [p.orgId, boardId]);
    const row = result.rows[0]; if (!row) throw new Fault('NOT_FOUND');
    const head = { epoch: row.head_epoch, head_seq: row.head_seq, storage_kind: row.storage_kind, manifest_key: row.manifest_key, manifest_digest: row.manifest_digest, manifest_plain_digest: row.manifest_plain_digest, manifest_size_bytes: row.manifest_size_bytes, tenant_key_version: row.tenant_key_version, schema_version: row.schema_version, protocol_version: row.protocol_version, fencing_token: row.fencing_token };
    assertHeadMatchesDocument(row, head);
    return { epoch: row.epoch, seq: row.seq, snapshot: row.snapshot, fresh: inserted.rows.length === 1, head };
  }
  async head(p: Principal, boardId: string): Promise<WhiteboardSyncHead> {
    validIds(p, boardId);
    return this.db.withTenant(p.orgId, async session => {
      const access = await this.access(session, p, boardId, false);
      const result = await session.query<{ epoch: number; seq: string; head_epoch: number | null; head_seq: string | null }>(`SELECT d.epoch,d.seq,h.epoch AS head_epoch,h.head_seq FROM whiteboard_documents d LEFT JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [p.orgId, boardId]);
      const row = result.rows[0];
      if (row) {
        if (row.head_epoch === null || row.head_seq === null) throw new BoardBlobError('INTEGRITY_FAILED', 'Board content head is missing');
        assertHeadMatchesDocument(row, { epoch: row.head_epoch, head_seq: row.head_seq });
      }
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

  async historyHead(p: Principal, boardId: string): Promise<H.HistoryHead> {
    validIds(p, boardId);
    return this.db.withTenant(p.orgId, async session => {
      const source = await this.historySource(session, p, boardId, false);
      return H.HistoryHead.parse({ epoch: source.epoch, seq: source.seq, digest: source.headDigest });
    });
  }
  async listHistoryCheckpoints(p: Principal, boardId: string): Promise<H.Checkpoint[]> {
    validIds(p, boardId);
    return this.db.withTenant(p.orgId, async session => {
      await this.historySource(session, p, boardId, false);
      const result = await session.query<HistoryCheckpointRow>(`SELECT ${historyCheckpointColumns} FROM whiteboard_checkpoints
        WHERE org_id=$1 AND board_id=$2 ORDER BY created_at DESC,checkpoint_id DESC LIMIT $3`, [p.orgId, boardId, H.WHITEBOARD_HISTORY_LIMITS.listedCheckpoints]);
      return result.rows.map(historyCheckpointView);
    });
  }
  async createHistoryCheckpoint(p: Principal, boardId: string, input: CreateCheckpointInput): Promise<H.Checkpoint> {
    validIds(p, boardId, input.requestId);
    const parsed = H.CreateCheckpoint.safeParse(input); if (!parsed.success) throw new Fault('VALIDATION_FAILED');
    const requestHash = HASH(JSON.stringify(canonical(parsed.data)));
    return this.db.withTenant(p.orgId, async session => {
      const source = await this.historySource(session, p, boardId, true);
      const existing = await session.query<HistoryCheckpointRow & { request_hash: string }>(`SELECT ${historyCheckpointColumns},request_hash FROM whiteboard_checkpoints
        WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4`, [p.orgId, boardId, p.userId, parsed.data.requestId]);
      if (existing.rows[0]) { if (existing.rows[0].request_hash !== requestHash) throw new Fault('IDEMPOTENCY_CONFLICT'); return historyCheckpointView(existing.rows[0]); }
      if (source.epoch !== parsed.data.expectedHead.epoch || source.seq !== parsed.data.expectedHead.seq || source.headDigest !== parsed.data.expectedHead.digest) throw new Fault('STALE_EPOCH');
      if (source.snapshot.byteLength > H.WHITEBOARD_HISTORY_LIMITS.checkpointBytes) throw new Fault('VALIDATION_FAILED');
      const objects = await this.validator.historyObjects(source.snapshot);
      if (objects.length > H.WHITEBOARD_HISTORY_LIMITS.checkpointObjects+5000) throw new Fault('VALIDATION_FAILED');
      const checkpointId = randomUUID();
      const staged = await this.stageHistoryBlob(p,{operationKind:'checkpoint',requestId:parsed.data.requestId,role:'history_checkpoint',boardId,plaintext:source.snapshot,kind:'checkpoint'});
      const blob = staged.blob;
      const inserted = await session.query<HistoryCheckpointRow>(`INSERT INTO whiteboard_checkpoints
        (org_id,board_id,checkpoint_id,actor_id,request_id,request_hash,label,reason,epoch,seq,head_manifest_digest,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,object_count,retention_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,clock_timestamp()+($18::text||' days')::interval)
        RETURNING ${historyCheckpointColumns}`,
      [p.orgId, boardId, checkpointId, p.userId, parsed.data.requestId, requestHash, parsed.data.label, parsed.data.reason,
        source.epoch, source.seq, source.headDigest, blob.key, blob.tenantKeyVersion, blob.cipherDigest, blob.plainDigest, blob.sizeBytes, objects.filter(value=>!value.deleted).length, parsed.data.retentionDays]);
      await this.finalizeHistoryIntent(session,p,staged.intentId,boardId,checkpointId);
      return historyCheckpointView(inserted.rows[0]!);
    });
  }
  async previewHistoryCheckpoint(p: Principal, boardId: string, checkpointId: string): Promise<ReturnType<typeof H.CheckpointPreview.parse>> {
    const { row, objects } = await this.historyCheckpointObjects(p, boardId, checkpointId),preview=historyRecords(objects).map(value=>value.preview);
    if (Buffer.byteLength(JSON.stringify(preview)) > H.WHITEBOARD_HISTORY_LIMITS.previewJsonBytes) throw new Fault('VALIDATION_FAILED');
    return H.CheckpointPreview.parse({ checkpoint: historyCheckpointView(row), objects:preview });
  }
  async compareHistoryCheckpoints(p: Principal, boardId: string, input: CompareCheckpointInput): Promise<ReturnType<typeof H.CheckpointComparison.parse>> {
    validIds(p, boardId);
    const parsed = H.CompareCheckpoint.safeParse(input); if (!parsed.success) throw new Fault('VALIDATION_FAILED');
    const from = await this.historyCheckpointObjects(p, boardId, parsed.data.fromCheckpointId);
    let targetObjects: HistoryRecord[], target: ReturnType<typeof H.CheckpointComparison.parse>['to'];
    if (parsed.data.to === 'current') {
      const current = await this.db.withTenant(p.orgId, session => this.historySource(session, p, boardId, false));
      targetObjects = await this.validator.historyObjects(current.snapshot);
      target = { kind: 'current', head: { epoch: current.epoch, seq: current.seq, digest: current.headDigest } };
    } else {
      const to = await this.historyCheckpointObjects(p, boardId, parsed.data.to);
      targetObjects = to.objects; target = { kind: 'checkpoint', checkpointId: to.row.checkpoint_id, contentDigest: to.row.content_sha256 };
    }
    const changes = compareHistoryRecords(from.objects, targetObjects);
    return H.CheckpointComparison.parse({ from: { checkpointId: from.row.checkpoint_id, contentDigest: from.row.content_sha256 }, to: target,
      added: changes.filter(change => change.change === 'added').length, modified: changes.filter(change => change.change === 'modified').length,
      deleted: changes.filter(change => change.change === 'deleted').length, changes });
  }
  async restoreHistoryCheckpoint(p: Principal, boardId: string, checkpointId: string, input: RestoreCheckpointInput): Promise<H.RestoreReceipt> {
    validIds(p, boardId, input.requestId); if (!H.CheckpointId.safeParse(checkpointId).success) throw new Fault('VALIDATION_FAILED');
    const parsed = H.RestoreCheckpoint.safeParse(input); if (!parsed.success) throw new Fault('VALIDATION_FAILED');
    const requestHash = HASH(JSON.stringify(canonical({ checkpointId, ...parsed.data })));
    return this.db.withTenant(p.orgId, async session => {
      await this.historySource(session, p, boardId, true);
      const replay = await session.query<HistoryRestoreRow & { request_hash: string }>(`SELECT restore_id,source_board_id,source_checkpoint_id,restored_board_id,restored_checkpoint_id,actor_id,reason,created_at,request_hash
        FROM whiteboard_checkpoint_restores WHERE org_id=$1 AND source_board_id=$2 AND actor_id=$3 AND request_id=$4`, [p.orgId, boardId, p.userId, parsed.data.requestId]);
      if (replay.rows[0]) { if (replay.rows[0].request_hash !== requestHash) throw new Fault('IDEMPOTENCY_CONFLICT'); return this.historyRestoreView(replay.rows[0], true); }
      const sourceResult = await session.query<HistoryCheckpointRow>(`SELECT ${historyCheckpointColumns} FROM whiteboard_checkpoints WHERE org_id=$1 AND board_id=$2 AND checkpoint_id=$3`, [p.orgId, boardId, checkpointId]);
      const source = sourceResult.rows[0]; if (!source) throw new Fault('NOT_FOUND');
      if (source.content_sha256 !== parsed.data.sourceContentDigest || (source.retention_state !== 'pinned' && new Date(source.retention_until).getTime() <= Date.now())) throw new Fault('VALIDATION_FAILED');
      const sourceSnapshot = await this.readHistoryCheckpointBlob(p, source),sourceObjects=await this.validator.historyObjects(sourceSnapshot);if(sourceObjects.filter(value=>!value.deleted).length!==source.object_count)throw new Fault('VALIDATION_FAILED');
      const snapshot=await this.copyHistorySnapshot(sourceSnapshot), objects = await this.validator.historyObjects(snapshot);
      // Stable across a crash after blob publication but before the metadata transaction commits.
      // The durable intent can therefore be found and the immutable ciphertext reused on retry.
      const restoredBoardId = restoredBoardIdForRequest(p.orgId,p.userId,boardId,checkpointId,parsed.data.requestId), restoredCheckpointId = randomUUID(), restoreId = randomUUID();
      const published = await this.publishHistoryRestoreContent(p,parsed.data.requestId,restoredBoardId,snapshot,source.head_manifest_digest);
      await session.query(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name) VALUES($1,$2,$3,$4,$5)`, [restoredBoardId, p.orgId, p.userId, randomUUID(), parsed.data.boardName]);
      await session.query(`INSERT INTO whiteboard_documents(org_id,board_id,epoch,seq,snapshot) VALUES($1,$2,1,0,NULL)`, [p.orgId, restoredBoardId]);
      await session.query(`INSERT INTO whiteboard_content_heads(org_id,board_id,epoch,head_seq,checkpoint_seq,storage_kind,manifest_key,manifest_digest,manifest_plain_digest,manifest_size_bytes,tenant_key_version,schema_version,protocol_version,fencing_token,content_state)
        VALUES($1,$2,1,0,0,'blob_primary',$3,$4,$5,$6,$7,1,1,1,'active')`,
      [p.orgId, restoredBoardId, published.key, published.cipherDigest, published.plainDigest, published.sizeBytes, published.checkpoint.tenantKeyVersion]);
      await session.query(`INSERT INTO whiteboard_checkpoints
        (org_id,board_id,checkpoint_id,actor_id,request_id,request_hash,label,reason,epoch,seq,head_manifest_digest,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,object_count,retention_until,source_board_id,source_checkpoint_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,0,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()+($16::text||' days')::interval,$17,$18)`,
      [p.orgId, restoredBoardId, restoredCheckpointId, p.userId, randomUUID(), HASH(`restored:${restoreId}`), source.label, parsed.data.reason,
        published.cipherDigest, published.checkpoint.key, published.checkpoint.tenantKeyVersion, published.checkpoint.cipherDigest,
        published.checkpoint.plainDigest, published.checkpoint.sizeBytes, objects.filter(value=>!value.deleted).length, parsed.data.retentionDays, boardId, checkpointId]);
      await this.finalizeHistoryIntent(session,p,published.checkpointIntentId,restoredBoardId,restoredCheckpointId);
      await this.finalizeHistoryIntent(session,p,published.manifestIntentId,restoredBoardId,restoredCheckpointId);
      const inserted = await session.query<HistoryRestoreRow>(`INSERT INTO whiteboard_checkpoint_restores
        (org_id,source_board_id,restore_id,source_checkpoint_id,restored_board_id,restored_checkpoint_id,actor_id,request_id,request_hash,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING restore_id,source_board_id,source_checkpoint_id,restored_board_id,restored_checkpoint_id,actor_id,reason,created_at`,
      [p.orgId, boardId, restoreId, checkpointId, restoredBoardId, restoredCheckpointId, p.userId, parsed.data.requestId, requestHash, parsed.data.reason]);
      return this.historyRestoreView(inserted.rows[0]!, false);
    });
  }
  async copyHistoryCheckpoint(p:Principal,boardId:string,checkpointId:string,input:RestoreCheckpointInput):Promise<H.RestoreReceipt>{return this.restoreHistoryCheckpoint(p,boardId,checkpointId,input);}

  private async copyHistorySnapshot(snapshot: Uint8Array): Promise<Uint8Array> {
    const records = await this.validator.historyObjects(snapshot);
    const live = records.filter(value => !value.deleted);
    const visibleIds = new Set(live.map(value => value.object.id));
    const liveById = new Map(live.map(value => [value.object.id, value]));
    const ids = new Map(live.map(value => [value.object.id, randomUUID()]));
    const depth = (value: HistoryRecord): number => {
      let result = 0, parent = value.object.parentId;
      const seen = new Set<string>();
      while (parent && visibleIds.has(parent) && !seen.has(parent)) {
        seen.add(parent); result++;
        parent = liveById.get(parent)?.object.parentId ?? null;
      }
      return result;
    };
    const copied = live
      .filter(value => !value.object.connector || visibleIds.has(value.object.connector.from) && visibleIds.has(value.object.connector.to))
      .sort((a, b) => Number(Boolean(a.object.connector)) - Number(Boolean(b.object.connector)) || depth(a) - depth(b))
      .map(({ object }) => ({ ...structuredClone(object), id: ids.get(object.id)!, restoredFrom: object.id,
        parentId: object.parentId && visibleIds.has(object.parentId) ? ids.get(object.parentId)! : null,
        ...(object.connector ? { connector: { from: ids.get(object.connector.from)!, to: ids.get(object.connector.to)! } } : {}) }));
    return this.validator.rebuild(copied);
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
      const changed = await session.query<{ fencing_token: string }>(`UPDATE whiteboard_content_heads SET epoch=$3,head_seq=$4,checkpoint_seq=$4,storage_kind='blob_primary',manifest_key=$5,manifest_digest=$6,manifest_plain_digest=$7,manifest_size_bytes=$8,tenant_key_version=$9,schema_version=1,protocol_version=1,content_state='active',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND head_seq=$10 AND fencing_token=$11 RETURNING fencing_token`, [p.orgId, boardId, epoch, seq, published.key, published.cipherDigest, published.plainDigest, published.sizeBytes, this.tenantKeyVersion, Number(doc.head.head_seq), Number(doc.head.fencing_token)]);
      if (!changed.rows[0]) throw new Error('WHITEBOARD_CONTENT_HEAD_CAS_CONFLICT');
    } else {
      await session.query(`UPDATE whiteboard_content_heads SET epoch=$3,head_seq=$4,checkpoint_seq=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId, epoch, seq]);
    }
    await session.query(`UPDATE whiteboards SET updated_at=now() WHERE org_id=$1 AND id=$2`, [p.orgId, boardId]);
    return { durability: 'pending', epoch, seq, updateId, replayed: false, update: accepted.update };
  }

  /** Internal history boundary: authorization and the content-head fence are read together. */
  async historySource(session: TenantSession, p: Principal, boardId: string, write: boolean): Promise<WhiteboardHistorySource> {
    await this.access(session, p, boardId, write);
    const doc = await this.document(session, p, boardId);
    if (doc.fresh && this.blobs && this.codec) await this.activateNewBoard(session, p, boardId, doc);
    if (!doc.head.manifest_digest) throw new Error('Board history requires blob-primary content');
    return { snapshot: await this.snapshot(p, boardId, doc), epoch: doc.epoch, seq: Number(doc.seq),
      headDigest: doc.head.manifest_digest, fencingToken: Number(doc.head.fencing_token) };
  }

  private async stageHistoryBlob(p: Principal,input:{operationKind:'checkpoint'|'restore';requestId:string;role:HistoryBlobIntentRow['blob_role'];boardId:string;plaintext:Uint8Array;kind:BoardBlobKind}):Promise<{intentId:string;createdAt:Date;blob:PublishedBoardContent['checkpoint']}>{
    if(!this.blobs||!this.codec)throw new Error('Board blob runtime is unavailable');
    const row=await this.db.withTenant(p.orgId,async session=>{
      await session.query(`INSERT INTO whiteboard_history_blob_intents(org_id,intent_id,actor_id,operation_kind,request_id,blob_role,board_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,actor_id,operation_kind,request_id,blob_role) DO NOTHING`,[p.orgId,randomUUID(),p.userId,input.operationKind,input.requestId,input.role,input.boardId]);
      const found=await session.query<HistoryBlobIntentRow>(`SELECT intent_id,blob_role,board_id,reference_board_id,reference_checkpoint_id,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,state,created_at,updated_at
        FROM whiteboard_history_blob_intents WHERE org_id=$1 AND actor_id=$2 AND operation_kind=$3 AND request_id=$4 AND blob_role=$5 FOR UPDATE`,[p.orgId,p.userId,input.operationKind,input.requestId,input.role]);
      const value=found.rows[0];if(!value||value.board_id!==input.boardId)throw new Fault('IDEMPOTENCY_CONFLICT');return value;
    });
    const plainDigest=sha256(input.plaintext);
    if(row.content_sha256&&row.content_sha256!==plainDigest)throw new Fault('IDEMPOTENCY_CONFLICT');
    if(row.blob_key&&row.cipher_sha256&&row.size_bytes&&row.blob_version){
      const head=await this.blobs.head({tenantId:p.orgId,key:row.blob_key});
      if(head){
        if(head.cipherDigest!==row.cipher_sha256||head.sizeBytes!==Number(row.size_bytes))throw new BoardBlobError('INTEGRITY_FAILED','history intent blob does not match');
        await this.readHistoryBlob(p,{key:row.blob_key,cipherDigest:row.cipher_sha256,plainDigest,sizeBytes:Number(row.size_bytes),tenantKeyVersion:row.blob_version});
        return{intentId:row.intent_id,createdAt:row.created_at,blob:{key:row.blob_key,cipherDigest:row.cipher_sha256,plainDigest,sizeBytes:Number(row.size_bytes),tenantKeyVersion:row.blob_version}};
      }
      if(row.state==='referenced')throw new BoardBlobError('INTEGRITY_FAILED','referenced history blob is missing');
    }
    const encoded=await this.codec.encrypt({tenantId:p.orgId,tenantKeyVersion:this.tenantKeyVersion,plaintext:input.plaintext});
    const key=boardBlobKey({tenantId:p.orgId,boardId:input.boardId,kind:input.kind,cipherDigest:encoded.cipherDigest});
    await this.db.withTenant(p.orgId,async session=>{const changed=await session.query<{intent_id:string}>(`UPDATE whiteboard_history_blob_intents SET blob_key=$3,blob_version=$4,cipher_sha256=$5,content_sha256=$6,size_bytes=$7,state='staging',updated_at=clock_timestamp()
      WHERE org_id=$1 AND intent_id=$2 AND state<>'referenced' RETURNING intent_id`,[p.orgId,row.intent_id,key,this.tenantKeyVersion,encoded.cipherDigest,encoded.plainDigest,encoded.sizeBytes]);if(!changed.rows[0])throw new Fault('IDEMPOTENCY_CONFLICT');});
    await this.putAndVerify(p.orgId,key,encoded);
    return{intentId:row.intent_id,createdAt:row.created_at,blob:{key,cipherDigest:encoded.cipherDigest,plainDigest:encoded.plainDigest,sizeBytes:encoded.sizeBytes,tenantKeyVersion:this.tenantKeyVersion}};
  }

  private async finalizeHistoryIntent(session:TenantSession,p:Principal,intentId:string,referenceBoardId:string,referenceCheckpointId:string):Promise<void>{
    const changed=await session.query<{intent_id:string}>(`UPDATE whiteboard_history_blob_intents SET state='referenced',reference_board_id=$3,reference_checkpoint_id=$4,updated_at=clock_timestamp()
      WHERE org_id=$1 AND intent_id=$2 AND state='staging' AND blob_key IS NOT NULL RETURNING intent_id`,[p.orgId,intentId,referenceBoardId,referenceCheckpointId]);
    if(!changed.rows[0])throw new Error('WHITEBOARD_HISTORY_BLOB_INTENT_CONFLICT');
  }

  private async publishHistoryRestoreContent(p:Principal,requestId:string,boardId:string,snapshot:Uint8Array,parentManifestDigest:string|null):Promise<PublishedBoardContent&{checkpointIntentId:string;manifestIntentId:string}>{
    const checkpoint=await this.stageHistoryBlob(p,{operationKind:'restore',requestId,role:'restore_checkpoint',boardId,plaintext:snapshot,kind:'checkpoint'});
    const manifest:BoardContentManifest={manifestVersion:1,boardId,epoch:1,headSeq:0,schemaVersion:CONTENT_SCHEMA_VERSION,checkpoint:{key:checkpoint.blob.key,plainDigest:checkpoint.blob.plainDigest,cipherDigest:checkpoint.blob.cipherDigest,sizeBytes:checkpoint.blob.sizeBytes,throughSeq:0},tail:[],parentManifestDigest,tenantKeyVersion:this.tenantKeyVersion,createdAt:checkpoint.createdAt.toISOString()};
    const manifestBlob=await this.stageHistoryBlob(p,{operationKind:'restore',requestId,role:'restore_manifest',boardId,plaintext:encodeBoardContentManifest(manifest),kind:'manifest'});
    return{key:manifestBlob.blob.key,cipherDigest:manifestBlob.blob.cipherDigest,plainDigest:manifestBlob.blob.plainDigest,sizeBytes:manifestBlob.blob.sizeBytes,checkpoint:checkpoint.blob,checkpointIntentId:checkpoint.intentId,manifestIntentId:manifestBlob.intentId};
  }

  /** Internal maintenance entrypoint: purge expired metadata, then digest-fenced unreferenced blobs. */
  async purgeHistoryRetention(orgId:Principal['orgId'],now=new Date(),stagingGraceMs=300000):Promise<{metadata:number;blobs:number}>{
    if(!this.blobs)throw new Error('Board blob runtime is unavailable');
    const metadata=await this.db.withTenant(orgId,async session=>{const deleted=await session.query<{checkpoint_id:string}>(`DELETE FROM whiteboard_checkpoints WHERE org_id=$1 AND retention_state='active' AND retention_until<=$2 RETURNING checkpoint_id`,[orgId,now]);return deleted.rows.length;});
    const candidates=await this.db.withTenant(orgId,session=>session.query<HistoryBlobIntentRow>(`SELECT intent_id,blob_role,board_id,reference_board_id,reference_checkpoint_id,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,state,created_at,updated_at FROM whiteboard_history_blob_intents WHERE org_id=$1 AND state<>'deleted' ORDER BY created_at,intent_id LIMIT 500`,[orgId]));
    let blobs=0;
    for(const candidate of candidates.rows){
      if(!candidate.blob_key||!candidate.cipher_sha256||!candidate.size_bytes)continue;
      const removed=await this.db.withTenant(orgId,async session=>{
        const locked=await session.query<HistoryBlobIntentRow>(`SELECT intent_id,blob_role,board_id,reference_board_id,reference_checkpoint_id,blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,state,created_at,updated_at FROM whiteboard_history_blob_intents WHERE org_id=$1 AND intent_id=$2 FOR UPDATE`,[orgId,candidate.intent_id]);const row=locked.rows[0];if(!row||row.state==='deleted'||!row.blob_key||!row.cipher_sha256||!row.size_bytes)return false;
        const refs=await session.query<{referenced:boolean}>(`SELECT (EXISTS(SELECT 1 FROM whiteboard_checkpoints WHERE org_id=$1 AND blob_key=$2) OR EXISTS(SELECT 1 FROM whiteboard_content_heads WHERE org_id=$1 AND manifest_key=$2) OR ($3='restore_checkpoint' AND EXISTS(SELECT 1 FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$4))) referenced`,[orgId,row.blob_key,row.blob_role,row.reference_board_id]);
        if(refs.rows[0]?.referenced){if(row.state!=='referenced')await session.query(`UPDATE whiteboard_history_blob_intents SET state='referenced',updated_at=clock_timestamp() WHERE org_id=$1 AND intent_id=$2`,[orgId,row.intent_id]);return false;}
        if(row.state==='staging'&&row.updated_at.getTime()>now.getTime()-stagingGraceMs)return false;
        await this.blobs!.deleteIfMatch({tenantId:orgId,key:row.blob_key,expectedCipherDigest:row.cipher_sha256,expectedSizeBytes:Number(row.size_bytes)});
        await session.query(`UPDATE whiteboard_history_blob_intents SET state='deleted',updated_at=clock_timestamp() WHERE org_id=$1 AND intent_id=$2`,[orgId,row.intent_id]);return true;
      });if(removed){blobs++;}
    }
    return{metadata,blobs};
  }

  async readHistoryBlob(p: Principal, input: { key: string; cipherDigest: string; plainDigest: string; sizeBytes: number; tenantKeyVersion: number }): Promise<Uint8Array> {
    if (!this.blobs || !this.codec) throw new Error('Board blob runtime is unavailable');
    const ciphertext = await this.blobs.getVerified({ tenantId: p.orgId, key: input.key, expectedCipherDigest: input.cipherDigest, expectedSizeBytes: input.sizeBytes });
    return this.codec.decrypt({ ...input, ciphertext, tenantId: p.orgId, expectedPlainDigest: input.plainDigest });
  }

  private async snapshot(p: Principal, boardId: string, doc: DocumentRow): Promise<Uint8Array> {
    if (doc.head.storage_kind === 'legacy_pg') {
      if (!doc.snapshot) throw new Error('Legacy Board snapshot is missing');
      return new Uint8Array(doc.snapshot);
    }
    if (!this.blobs || !this.codec || !doc.head.manifest_key || !doc.head.manifest_digest || !doc.head.manifest_plain_digest || !doc.head.manifest_size_bytes || !doc.head.tenant_key_version) {
      throw new Error('Board blob runtime is unavailable');
    }
    if (doc.head.schema_version !== CONTENT_SCHEMA_VERSION || doc.head.protocol_version !== CONTENT_PROTOCOL_VERSION) throw new Error('Unsupported Board content head version');
    const encryptedManifest = await this.blobs.getVerified({ tenantId: p.orgId, key: doc.head.manifest_key, expectedCipherDigest: doc.head.manifest_digest, expectedSizeBytes: Number(doc.head.manifest_size_bytes) });
    const manifestBytes = await this.codec.decrypt({ ciphertext: encryptedManifest, cipherDigest: doc.head.manifest_digest, plainDigest: doc.head.manifest_plain_digest, expectedPlainDigest: doc.head.manifest_plain_digest, sizeBytes: Number(doc.head.manifest_size_bytes), tenantId: p.orgId, tenantKeyVersion: doc.head.tenant_key_version });
    const manifest = decodeBoardContentManifest(manifestBytes);
    if (manifest.boardId !== boardId || manifest.epoch !== doc.epoch || manifest.headSeq !== Number(doc.seq) || manifest.tenantKeyVersion !== doc.head.tenant_key_version || manifest.schemaVersion !== doc.head.schema_version) throw new Error('Board manifest head mismatch');
    const encrypted = await this.blobs.getVerified({ tenantId: p.orgId, key: manifest.checkpoint.key, expectedCipherDigest: manifest.checkpoint.cipherDigest, expectedSizeBytes: manifest.checkpoint.sizeBytes });
    return this.codec.decrypt({ ...manifest.checkpoint, ciphertext: encrypted, tenantId: p.orgId, tenantKeyVersion: manifest.tenantKeyVersion, expectedPlainDigest: manifest.checkpoint.plainDigest });
  }

  private async activateNewBoard(session: TenantSession, p: Principal, boardId: string, doc: DocumentRow): Promise<void> {
    if (!doc.snapshot) throw new Error('New Board snapshot is missing');
    const published = await this.publish(p, boardId, doc.epoch, Number(doc.seq), doc.snapshot, null);
    const changed = await session.query<{ fencing_token: string }>(`UPDATE whiteboard_content_heads SET storage_kind='blob_primary',manifest_key=$3,manifest_digest=$4,manifest_plain_digest=$5,manifest_size_bytes=$6,tenant_key_version=$7,schema_version=1,protocol_version=1,content_state='active',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND head_seq=0 AND fencing_token=0 RETURNING fencing_token`, [p.orgId, boardId, published.key, published.cipherDigest, published.plainDigest, published.sizeBytes, this.tenantKeyVersion]);
    if (!changed.rows[0]) throw new Error('WHITEBOARD_CONTENT_HEAD_CAS_CONFLICT');
    await session.query(`UPDATE whiteboard_documents SET snapshot=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2`, [p.orgId, boardId]);
    doc.snapshot = null; doc.fresh = false;
    doc.head = { ...doc.head, storage_kind: 'blob_primary', manifest_key: published.key, manifest_digest: published.cipherDigest, manifest_plain_digest: published.plainDigest, manifest_size_bytes: String(published.sizeBytes), tenant_key_version: this.tenantKeyVersion, schema_version: CONTENT_SCHEMA_VERSION, protocol_version: CONTENT_PROTOCOL_VERSION, fencing_token: changed.rows[0].fencing_token };
  }

  private async publish(p: Principal, boardId: string, epoch: number, seq: number, snapshot: Uint8Array, parentManifestDigest: string | null): Promise<PublishedBoardContent> {
    const checkpoint = await this.codec!.encrypt({ tenantId: p.orgId, tenantKeyVersion: this.tenantKeyVersion, plaintext: snapshot });
    const checkpointKey = boardBlobKey({ tenantId: p.orgId, boardId, kind: 'checkpoint', cipherDigest: checkpoint.cipherDigest });
    await this.putAndVerify(p.orgId, checkpointKey, checkpoint);
    const manifest: BoardContentManifest = {
      manifestVersion: 1, boardId, epoch, headSeq: seq, schemaVersion: CONTENT_SCHEMA_VERSION,
      checkpoint: { key: checkpointKey, plainDigest: checkpoint.plainDigest, cipherDigest: checkpoint.cipherDigest, sizeBytes: checkpoint.sizeBytes, throughSeq: seq },
      tail: [], parentManifestDigest, tenantKeyVersion: this.tenantKeyVersion, createdAt: new Date().toISOString(),
    };
    const bytes = encodeBoardContentManifest(manifest);
    const encrypted = await this.codec!.encrypt({ tenantId: p.orgId, tenantKeyVersion: this.tenantKeyVersion, plaintext: bytes });
    const key = boardBlobKey({ tenantId: p.orgId, boardId, kind: 'manifest', cipherDigest: encrypted.cipherDigest });
    await this.putAndVerify(p.orgId, key, encrypted);
    const readback = await this.blobs!.getVerified({ tenantId: p.orgId, key, expectedCipherDigest: encrypted.cipherDigest, expectedSizeBytes: encrypted.sizeBytes });
    const decodedBytes = await this.codec!.decrypt({ ...encrypted, ciphertext: readback, tenantId: p.orgId, expectedPlainDigest: encrypted.plainDigest });
    const decoded = decodeBoardContentManifest(decodedBytes);
    if (decoded.boardId !== boardId || decoded.epoch !== epoch || decoded.headSeq !== seq || sha256(decodedBytes) !== encrypted.plainDigest) throw new Error('Board manifest read-back mismatch');
    return { key, cipherDigest: encrypted.cipherDigest, plainDigest: encrypted.plainDigest, sizeBytes: encrypted.sizeBytes,
      checkpoint: { key: checkpointKey, cipherDigest: checkpoint.cipherDigest, plainDigest: checkpoint.plainDigest,
        sizeBytes: checkpoint.sizeBytes, tenantKeyVersion: this.tenantKeyVersion } };
  }

  private async historyCheckpointObjects(p: Principal, boardId: string, checkpointId: string): Promise<{ row: HistoryCheckpointRow; objects: HistoryRecord[] }> {
    validIds(p, boardId); if (!H.CheckpointId.safeParse(checkpointId).success) throw new Fault('VALIDATION_FAILED');
    return this.db.withTenant(p.orgId, async session => {
      await this.historySource(session, p, boardId, false);
      const result = await session.query<HistoryCheckpointRow>(`SELECT ${historyCheckpointColumns} FROM whiteboard_checkpoints WHERE org_id=$1 AND board_id=$2 AND checkpoint_id=$3`, [p.orgId, boardId, checkpointId]);
      const row = result.rows[0]; if (!row) throw new Fault('NOT_FOUND');
      if(row.retention_state!=='pinned'&&new Date(row.retention_until).getTime()<=Date.now())throw new Fault('NOT_FOUND');
      const snapshot = await this.readHistoryCheckpointBlob(p, row), objects = await this.validator.historyObjects(snapshot);
      if (objects.filter(value=>!value.deleted).length !== row.object_count) throw new Fault('VALIDATION_FAILED');
      return { row, objects };
    });
  }
  private historyRestoreView(row: HistoryRestoreRow, replayed: boolean): H.RestoreReceipt {
    return H.RestoreReceipt.parse({ restoreId: row.restore_id, sourceBoardId: row.source_board_id, sourceCheckpointId: row.source_checkpoint_id,
      restoredBoardId: row.restored_board_id, restoredCheckpointId: row.restored_checkpoint_id, actorId: row.actor_id,
      reason: row.reason, createdAt: new Date(row.created_at).toISOString(), replayed });
  }
  private readHistoryCheckpointBlob(p: Principal, row: HistoryCheckpointRow): Promise<Uint8Array> {
    return this.readHistoryBlob(p, { key: row.blob_key, cipherDigest: row.cipher_sha256, plainDigest: row.content_sha256,
      sizeBytes: Number(row.size_bytes), tenantKeyVersion: row.blob_version });
  }

  private async putAndVerify(tenantId: string, key: string, blob: EncodedBoardBlob): Promise<void> {
    await this.blobs!.putImmutable({ tenantId, key, ciphertext: blob.ciphertext, cipherDigest: blob.cipherDigest, sizeBytes: blob.sizeBytes });
    const readback = await this.blobs!.getVerified({ tenantId, key, expectedCipherDigest: blob.cipherDigest, expectedSizeBytes: blob.sizeBytes });
    await this.codec!.decrypt({ ...blob, ciphertext: readback, tenantId, expectedPlainDigest: blob.plainDigest });
  }
}
