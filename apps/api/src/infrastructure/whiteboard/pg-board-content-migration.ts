import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { BoardContentMigrationRecord, BoardContentMigrationRepository, BoardMigrationCandidate, BoardRetirementHead, LegacyBoardInventory, LegacyBoardWatermark } from '../../application/whiteboard/content-migration-ports';
import { toOrgId } from '../../domain/org-id';

type MigrationRow = {
  job_id: string; state: BoardContentMigrationRecord['state']; source_epoch: number; source_head_seq: string; source_fencing_token: string;
  candidate_manifest_key: string | null; candidate_manifest_digest: string | null; candidate_manifest_plain_digest: string | null;
  candidate_manifest_size_bytes: string | null; candidate_tenant_key_version: number | null; candidate_schema_version: number | null;
  candidate_protocol_version: number | null; candidate_head_seq: string | null; cleanup_through_seq: string; attempts: number; last_error_code: string | null;
  cutover_at: Date | string | null; retirement_not_before: Date | string | null; retirement_proof_digest: string | null;
  retirement_epoch: number | null; retirement_head_seq: string | null; retirement_manifest_digest: string | null; retirement_checkpoint_digest: string | null;
};

function safe(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('WHITEBOARD_MIGRATION_INVALID_WATERMARK');
  return parsed;
}

function record(row: MigrationRow): BoardContentMigrationRecord {
  const candidate: BoardMigrationCandidate | null = row.candidate_manifest_key === null ? null : {
    manifestKey: row.candidate_manifest_key,
    manifestDigest: row.candidate_manifest_digest!,
    manifestPlainDigest: row.candidate_manifest_plain_digest!,
    manifestSizeBytes: safe(row.candidate_manifest_size_bytes!),
    tenantKeyVersion: safe(row.candidate_tenant_key_version!),
  };
  return { jobId: row.job_id, state: row.state, sourceEpoch: safe(row.source_epoch), sourceHeadSeq: safe(row.source_head_seq),
    sourceFencingToken: safe(row.source_fencing_token), candidate, cleanupThroughSeq: safe(row.cleanup_through_seq),
    cutoverAt: row.cutover_at === null ? null : new Date(row.cutover_at).toISOString(), retirementNotBefore: row.retirement_not_before === null ? null : new Date(row.retirement_not_before).toISOString(),
    retirementProofDigest: row.retirement_proof_digest, retirementEpoch: row.retirement_epoch === null ? null : safe(row.retirement_epoch), retirementHeadSeq: row.retirement_head_seq === null ? null : safe(row.retirement_head_seq),
    retirementManifestDigest: row.retirement_manifest_digest, retirementCheckpointDigest: row.retirement_checkpoint_digest,
    attempts: safe(row.attempts), lastErrorCode: row.last_error_code };
}

const RETURNING = `job_id,state,source_epoch,source_head_seq,source_fencing_token,candidate_manifest_key,candidate_manifest_digest,candidate_manifest_plain_digest,candidate_manifest_size_bytes,candidate_tenant_key_version,candidate_schema_version,candidate_protocol_version,candidate_head_seq,cleanup_through_seq,cutover_at,retirement_not_before,retirement_proof_digest,retirement_epoch,retirement_head_seq,retirement_manifest_digest,retirement_checkpoint_digest,attempts,last_error_code`;
const RETURNING_MIGRATION = RETURNING.split(',').map(column => `m.${column}`).join(',');

class PgBoardContentMigrationTransaction {
  constructor(private readonly session: TenantSession, private readonly tenantId: string, private readonly boardId: string) {}

  async loadOrEnroll(jobId: string): Promise<BoardContentMigrationRecord> {
    const head = await this.session.query<{ epoch: number; head_seq: string; fencing_token: string }>(
      `SELECT h.epoch,h.head_seq,h.fencing_token FROM whiteboards b JOIN whiteboard_content_heads h ON h.org_id=b.org_id AND h.board_id=b.id WHERE b.org_id=$1 AND b.id=$2 FOR UPDATE OF b,h`,
      [this.tenantId, this.boardId]);
    if (!head.rows[0]) throw new Error('WHITEBOARD_NOT_FOUND');
    await this.session.query(`INSERT INTO whiteboard_content_migrations(org_id,board_id,job_id,source_epoch,source_head_seq,source_fencing_token) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,board_id) DO NOTHING`,
      [this.tenantId, this.boardId, jobId, head.rows[0].epoch, head.rows[0].head_seq, head.rows[0].fencing_token]);
    const loaded = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET attempts=attempts+1,last_error_code=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2 RETURNING ${RETURNING}`,
      [this.tenantId, this.boardId]);
    if (!loaded.rows[0]) throw new Error('WHITEBOARD_MIGRATION_NOT_FOUND');
    return record(loaded.rows[0]);
  }

  async captureWatermark(): Promise<LegacyBoardWatermark> {
    const source = await this.session.query<{ epoch: number; seq: string; storage_kind: 'legacy_pg' | 'dual_write' | 'blob_primary'; fencing_token: string }>(
      `SELECT d.epoch,d.seq,h.storage_kind,h.fencing_token FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2 FOR UPDATE OF d,h`,
      [this.tenantId, this.boardId]);
    const row = source.rows[0];
    if (!row) throw new Error('WHITEBOARD_DOCUMENT_NOT_FOUND');
    if (row.storage_kind === 'dual_write') throw new Error('WHITEBOARD_MIGRATION_DUAL_WRITE_UNSUPPORTED');
    return { epoch: safe(row.epoch), headSeq: safe(row.seq), fencingToken: safe(row.fencing_token), storageKind: row.storage_kind };
  }

  async readInventory(watermark: LegacyBoardWatermark): Promise<LegacyBoardInventory> {
    const rows = await this.session.query<{ kind: number; epoch: number; seq: string; bytes: Buffer | null; foreign_count: string }>(`WITH source AS (
      SELECT epoch,seq,snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$4
    ), current_updates AS (
      SELECT epoch,seq,update FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq BETWEEN 1 AND $4
    ), foreign_updates AS (
      SELECT count(*)::text count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch<>$3
    )
    SELECT 0 kind,s.epoch,s.seq,s.snapshot bytes,f.count foreign_count FROM source s CROSS JOIN foreign_updates f
    UNION ALL
    SELECT 1 kind,u.epoch,u.seq,u.update bytes,f.count foreign_count FROM current_updates u CROSS JOIN foreign_updates f
    ORDER BY kind,seq`, [this.tenantId, this.boardId, watermark.epoch, watermark.headSeq]);
    const source = rows.rows[0];
    if (!source || source.kind !== 0 || safe(source.epoch) !== watermark.epoch || safe(source.seq) !== watermark.headSeq) throw new Error('WHITEBOARD_MIGRATION_WATERMARK_CHANGED');
    if (safe(source.foreign_count) !== 0) throw new Error('LEGACY_CROSS_EPOCH_UPDATE');
    return { ...watermark, snapshot: source.bytes === null ? null : new Uint8Array(source.bytes), updates: rows.rows.slice(1).map(row => {
      if (row.kind !== 1 || safe(row.epoch) !== watermark.epoch || row.bytes === null) throw new Error('LEGACY_UPDATE_MISSING');
      return { seq: safe(row.seq), update: new Uint8Array(row.bytes) };
    }) };
  }

  async saveCandidate(current: BoardContentMigrationRecord, candidate: BoardMigrationCandidate): Promise<BoardContentMigrationRecord> {
    await this.lockWatermark(current);
    const result = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET state='candidate_ready',candidate_manifest_key=$4,candidate_manifest_digest=$5,candidate_manifest_plain_digest=$6,candidate_manifest_size_bytes=$7,candidate_tenant_key_version=$8,candidate_schema_version=1,candidate_protocol_version=1,candidate_head_seq=source_head_seq,last_error_code=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state='enrolled' AND source_epoch=$9 AND source_head_seq=$10 AND source_fencing_token=$11 RETURNING ${RETURNING}`,
      [this.tenantId, this.boardId, current.jobId, candidate.manifestKey, candidate.manifestDigest, candidate.manifestPlainDigest, candidate.manifestSizeBytes, candidate.tenantKeyVersion, current.sourceEpoch, current.sourceHeadSeq, current.sourceFencingToken]);
    if (!result.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    return record(result.rows[0]);
  }

  async markVerified(current: BoardContentMigrationRecord): Promise<BoardContentMigrationRecord> {
    await this.lockWatermark(current);
    return this.transition(current, 'candidate_ready', 'verified');
  }

  async cutover(current: BoardContentMigrationRecord, retirementNotBefore: Date): Promise<BoardContentMigrationRecord> {
    const candidate = current.candidate;
    if (!candidate) throw new Error('WHITEBOARD_MIGRATION_CANDIDATE_MISSING');
    const head = await this.session.query(`UPDATE whiteboard_content_heads SET storage_kind='blob_primary',manifest_key=$4,manifest_digest=$5,manifest_plain_digest=$6,manifest_size_bytes=$7,tenant_key_version=$8,schema_version=1,protocol_version=1,checkpoint_seq=$9,content_state='rollback',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND storage_kind='legacy_pg' AND epoch=$3 AND head_seq=$9 AND fencing_token=$10 RETURNING fencing_token`,
      [this.tenantId, this.boardId, current.sourceEpoch, candidate.manifestKey, candidate.manifestDigest, candidate.manifestPlainDigest, candidate.manifestSizeBytes, candidate.tenantKeyVersion, current.sourceHeadSeq, current.sourceFencingToken]);
    if (!head.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    const migrated = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET state='cutover',cutover_at=now(),retirement_not_before=$4,last_error_code=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state='verified' RETURNING ${RETURNING}`, [this.tenantId, this.boardId, current.jobId, retirementNotBefore.toISOString()]);
    if (!migrated.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    return record(migrated.rows[0]);
  }

  async captureRetirementHead(): Promise<BoardRetirementHead> {
    const result = await this.session.query<{ epoch: number; head_seq: string; fencing_token: string; storage_kind: string; content_state: string; manifest_key: string | null; manifest_digest: string | null; manifest_plain_digest: string | null; manifest_size_bytes: string | null; tenant_key_version: number | null }>(`SELECT epoch,head_seq,fencing_token,storage_kind,content_state,manifest_key,manifest_digest,manifest_plain_digest,manifest_size_bytes,tenant_key_version FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2 FOR UPDATE`, [this.tenantId, this.boardId]);
    const head = result.rows[0];
    if (!head || head.storage_kind !== 'blob_primary' || head.content_state !== 'rollback' || !head.manifest_key || !head.manifest_digest || !head.manifest_plain_digest || !head.manifest_size_bytes || !head.tenant_key_version) throw new Error('RETIREMENT_HEAD_INVALID');
    return { epoch: safe(head.epoch), headSeq: safe(head.head_seq), fencingToken: safe(head.fencing_token), storageKind: 'blob_primary', manifestKey: head.manifest_key, manifestDigest: head.manifest_digest, manifestPlainDigest: head.manifest_plain_digest, manifestSizeBytes: safe(head.manifest_size_bytes), tenantKeyVersion: safe(head.tenant_key_version) };
  }

  async beginRetirement(current: BoardContentMigrationRecord, head: BoardRetirementHead, checkpointDigest: string, proofDigest: string, now: Date): Promise<BoardContentMigrationRecord> {
    const activated = await this.session.query<{ fencing_token: string }>(`UPDATE whiteboard_content_heads SET content_state='active',fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND storage_kind='blob_primary' AND content_state='rollback' AND epoch=$3 AND head_seq=$4 AND fencing_token=$5 AND manifest_digest=$6 RETURNING fencing_token`,
      [this.tenantId, this.boardId, head.epoch, head.headSeq, head.fencingToken, head.manifestDigest]);
    if (!activated.rows[0]) throw new Error('RETIREMENT_POLICY_OR_HEAD_CHANGED');
    const result = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations m SET state='cleaning',retirement_proof_digest=$4,retirement_started_at=$5,retirement_epoch=$6,retirement_head_seq=$7,retirement_manifest_digest=$8,retirement_checkpoint_digest=$9,updated_at=now() FROM whiteboard_content_heads h WHERE m.org_id=$1 AND m.board_id=$2 AND m.job_id=$3 AND m.state='cutover' AND m.retirement_not_before<=$5 AND h.org_id=m.org_id AND h.board_id=m.board_id AND h.storage_kind='blob_primary' AND h.epoch=$6 AND h.head_seq=$7 AND h.fencing_token=$10 AND h.manifest_digest=$8 RETURNING ${RETURNING_MIGRATION}`, [this.tenantId, this.boardId, current.jobId, proofDigest, now.toISOString(), head.epoch, head.headSeq, head.manifestDigest, checkpointDigest, activated.rows[0]!.fencing_token]);
    if (!result.rows[0]) throw new Error('RETIREMENT_POLICY_OR_HEAD_CHANGED');
    return record(result.rows[0]);
  }

  async cleanupBatch(current: BoardContentMigrationRecord, batchSize: number): Promise<BoardContentMigrationRecord> {
    if (current.state !== 'cleaning' || current.retirementEpoch === null || current.retirementHeadSeq === null) return current;
    const cleared = await this.session.query<{ seq: string }>(`WITH batch AS (SELECT seq FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq<=$4 AND update IS NOT NULL ORDER BY seq LIMIT $5 FOR UPDATE) UPDATE whiteboard_updates u SET update=NULL FROM batch WHERE u.org_id=$1 AND u.board_id=$2 AND u.epoch=$3 AND u.seq=batch.seq RETURNING u.seq`,
      [this.tenantId, this.boardId, current.retirementEpoch, current.retirementHeadSeq, batchSize]);
    const through = cleared.rows.reduce((max, row) => Math.max(max, safe(row.seq)), current.cleanupThroughSeq);
    const remaining = await this.session.query<{ count: string }>(`SELECT count(*)::text count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq<=$4 AND update IS NOT NULL`, [this.tenantId, this.boardId, current.retirementEpoch, current.retirementHeadSeq]);
    const done = safe(remaining.rows[0]?.count ?? '0') === 0;
    if (done) await this.session.query(`UPDATE whiteboard_documents SET snapshot=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$4`, [this.tenantId, this.boardId, current.retirementEpoch, current.retirementHeadSeq]);
    const next = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET state=$4,cleanup_through_seq=$5,completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state='cleaning' RETURNING ${RETURNING}`,
      [this.tenantId, this.boardId, current.jobId, done ? 'completed' : 'cleaning', through]);
    if (!next.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    return record(next.rows[0]);
  }

  async resetForChangedSource(current: BoardContentMigrationRecord, inventory: LegacyBoardWatermark): Promise<BoardContentMigrationRecord> {
    if (inventory.storageKind !== 'legacy_pg') throw new Error('WHITEBOARD_MIGRATION_SOURCE_CHANGED');
    const locked = await this.session.query<{ epoch: number; head_seq: string; fencing_token: string; storage_kind: string }>(`SELECT epoch,head_seq,fencing_token,storage_kind FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2 FOR UPDATE`, [this.tenantId, this.boardId]);
    const head = locked.rows[0];
    if (!head || head.storage_kind !== 'legacy_pg' || safe(head.epoch) !== inventory.epoch || safe(head.head_seq) !== inventory.headSeq || safe(head.fencing_token) !== inventory.fencingToken) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    const result = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET state='enrolled',source_epoch=$4,source_head_seq=$5,source_fencing_token=$6,candidate_manifest_key=NULL,candidate_manifest_digest=NULL,candidate_manifest_plain_digest=NULL,candidate_manifest_size_bytes=NULL,candidate_tenant_key_version=NULL,candidate_schema_version=NULL,candidate_protocol_version=NULL,candidate_head_seq=NULL,cleanup_through_seq=0,last_error_code='WATERMARK_CHANGED',updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state IN ('enrolled','candidate_ready','verified') RETURNING ${RETURNING}`,
      [this.tenantId, this.boardId, current.jobId, inventory.epoch, inventory.headSeq, inventory.fencingToken]);
    if (!result.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    return record(result.rows[0]);
  }

  private async transition(current: BoardContentMigrationRecord, from: BoardContentMigrationRecord['state'], to: BoardContentMigrationRecord['state']): Promise<BoardContentMigrationRecord> {
    const result = await this.session.query<MigrationRow>(`UPDATE whiteboard_content_migrations SET state=$4,last_error_code=NULL,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state=$5 RETURNING ${RETURNING}`,
      [this.tenantId, this.boardId, current.jobId, to, from]);
    if (!result.rows[0]) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
    return record(result.rows[0]);
  }

  private async lockWatermark(current: BoardContentMigrationRecord): Promise<void> {
    const result = await this.session.query<{ epoch: number; head_seq: string; fencing_token: string; storage_kind: string }>(`SELECT epoch,head_seq,fencing_token,storage_kind FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2 FOR UPDATE`, [this.tenantId, this.boardId]);
    const head = result.rows[0];
    if (!head || head.storage_kind !== 'legacy_pg' || safe(head.epoch) !== current.sourceEpoch || safe(head.head_seq) !== current.sourceHeadSeq || safe(head.fencing_token) !== current.sourceFencingToken) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
  }
}

export class PgBoardContentMigrationRepository implements BoardContentMigrationRepository {
  constructor(private readonly db: DatabasePort) {}
  private run<T>(tenantId: string, boardId: string, operation: (tx: PgBoardContentMigrationTransaction) => Promise<T>): Promise<T> {
    return this.db.withTenant(toOrgId(tenantId), session => operation(new PgBoardContentMigrationTransaction(session, tenantId, boardId)));
  }
  loadOrEnroll(tenantId: string, boardId: string, jobId: string) { return this.run(tenantId, boardId, tx => tx.loadOrEnroll(jobId)); }
  captureWatermark(tenantId: string, boardId: string) { return this.run(tenantId, boardId, tx => tx.captureWatermark()); }
  readInventory(tenantId: string, boardId: string, watermark: LegacyBoardWatermark) { return this.run(tenantId, boardId, tx => tx.readInventory(watermark)); }
  saveCandidate(tenantId: string, boardId: string, current: BoardContentMigrationRecord, candidate: BoardMigrationCandidate) { return this.run(tenantId, boardId, tx => tx.saveCandidate(current, candidate)); }
  markVerified(tenantId: string, boardId: string, current: BoardContentMigrationRecord) { return this.run(tenantId, boardId, tx => tx.markVerified(current)); }
  cutover(tenantId: string, boardId: string, current: BoardContentMigrationRecord, retirementNotBefore: Date) { return this.run(tenantId, boardId, tx => tx.cutover(current, retirementNotBefore)); }
  captureRetirementHead(tenantId: string, boardId: string) { return this.run(tenantId, boardId, tx => tx.captureRetirementHead()); }
  beginRetirement(tenantId: string, boardId: string, current: BoardContentMigrationRecord, head: BoardRetirementHead, checkpointDigest: string, proofDigest: string, now: Date) { return this.run(tenantId, boardId, tx => tx.beginRetirement(current, head, checkpointDigest, proofDigest, now)); }
  cleanupBatch(tenantId: string, boardId: string, current: BoardContentMigrationRecord, batchSize: number) { return this.run(tenantId, boardId, tx => tx.cleanupBatch(current, batchSize)); }
  resetForChangedSource(tenantId: string, boardId: string, current: BoardContentMigrationRecord, inventory: LegacyBoardWatermark) { return this.run(tenantId, boardId, tx => tx.resetForChangedSource(current, inventory)); }
  async recordFailure(tenantId: string, boardId: string, jobId: string, errorCode: string): Promise<void> {
    await this.db.withTenant(toOrgId(tenantId), session => session.query(`UPDATE whiteboard_content_migrations SET attempts=attempts+1,last_error_code=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND job_id=$3 AND state<>'completed'`, [tenantId, boardId, jobId, errorCode]));
  }
}
