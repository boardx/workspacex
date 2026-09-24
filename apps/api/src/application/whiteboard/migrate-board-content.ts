import type { BoardBlobCodec, BoardBlobStore, EncodedBoardBlob } from './blob-ports';
import type { BoardContentMigrationRecord, BoardContentMigrationRepository, BoardMigrationCandidate, BoardRetirementHead, LegacyBoardInventory, LegacyBoardWatermark } from './content-migration-ports';
import { boardContentRetirementPolicy } from './content-retirement-policy';
import { boardBlobKey, sha256 } from '../../domain/whiteboard/blob-identity';
import { decodeBoardContentManifest, encodeBoardContentManifest, type BoardContentManifest } from '../../domain/whiteboard/content-manifest';
import { mergeLegacyYjsContent, yjsSemanticallyEqual } from '../../domain/whiteboard/yjs-semantic-equivalence';
import { verifyBoardRetirementCredential, type BoardRetirementCredential } from '../../domain/whiteboard/retirement-credential';

const SCHEMA_VERSION = 1, PROTOCOL_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type BoardContentMigrationReport = {
  jobId: string; state: BoardContentMigrationRecord['state']; sourceEpoch: number; sourceHeadSeq: number;
  candidateManifestDigest: string | null; cleanupThroughSeq: number; attempts: number; errorCode: string | null;
  cutoverAt: string | null; retirementNotBefore: string | null; retirementProofDigest: string | null;
};

function report(record: BoardContentMigrationRecord): BoardContentMigrationReport {
  return { jobId: record.jobId, state: record.state, sourceEpoch: record.sourceEpoch, sourceHeadSeq: record.sourceHeadSeq,
    candidateManifestDigest: record.candidate?.manifestDigest ?? null, cleanupThroughSeq: record.cleanupThroughSeq,
    attempts: record.attempts, errorCode: record.lastErrorCode, cutoverAt: record.cutoverAt,
    retirementNotBefore: record.retirementNotBefore, retirementProofDigest: record.retirementProofDigest };
}

function errorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/^[A-Z0-9_]{1,64}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('SEMANTIC')) return 'SEMANTIC_MISMATCH';
  if (message.includes('WATERMARK')) return 'WATERMARK_CHANGED';
  if (message.includes('JOB')) return 'JOB_CONFLICT';
  return 'MIGRATION_FAILED';
}

function isCasLost(error: unknown): boolean {
  return error instanceof Error && error.message.includes('CAS_LOST');
}

export class MigrateBoardContent {
  constructor(
    private readonly repository: BoardContentMigrationRepository,
    private readonly blobs: BoardBlobStore,
    private readonly codec: BoardBlobCodec,
    private readonly tenantKeyVersion: number,
    private readonly cleanupBatchSize = 100,
    private readonly rollbackWindowMs = boardContentRetirementPolicy().rollbackWindowMs,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(tenantKeyVersion) || tenantKeyVersion < 1) throw new Error('Invalid tenant key version');
    if (!Number.isSafeInteger(cleanupBatchSize) || cleanupBatchSize < 1 || cleanupBatchSize > 1000) throw new Error('Invalid cleanup batch size');
    if (!Number.isSafeInteger(rollbackWindowMs) || rollbackWindowMs < 1) throw new Error('Invalid rollback window');
  }

  /** Advances exactly one durable phase, making process interruption a normal retry boundary. */
  async step(input: { tenantId: string; boardId: string; jobId: string }): Promise<BoardContentMigrationReport> {
    if (!input.tenantId || !UUID.test(input.boardId) || !UUID.test(input.jobId)) throw new Error('INVALID_MIGRATION_IDENTITY');
    try {
      let record = await this.repository.loadOrEnroll(input.tenantId, input.boardId, input.jobId);
      if (record.jobId !== input.jobId) throw new Error('JOB_CONFLICT');
      if (record.state === 'completed') return report(record);
      if (record.state === 'enrolled') {
        const watermark = await this.repository.captureWatermark(input.tenantId, input.boardId);
        const inventory = await this.repository.readInventory(input.tenantId, input.boardId, watermark);
        if (inventory.storageKind === 'blob_primary') throw new Error('ALREADY_BLOB_PRIMARY');
        this.assertInventory(inventory);
        if (!this.sameWatermark(record, inventory)) {
          record = await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, inventory);
          return report(record);
        }
        // Object I/O intentionally happens after captureWatermark's short row-lock
        // transaction. saveCandidate re-locks and rejects a changed watermark.
        const candidate = await this.buildCandidate(input.tenantId, input.boardId, inventory);
        try { return report(await this.repository.saveCandidate(input.tenantId, input.boardId, record, candidate)); }
        catch (error) {
          if (!isCasLost(error)) throw error;
          const current = await this.repository.captureWatermark(input.tenantId, input.boardId);
          return report(await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, current));
        }
      }
      if (record.state === 'candidate_ready') {
        const watermark = await this.repository.captureWatermark(input.tenantId, input.boardId);
        const inventory = await this.repository.readInventory(input.tenantId, input.boardId, watermark);
        this.assertInventory(inventory);
        if (!this.sameWatermark(record, inventory)) return report(await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, inventory));
        const source = this.sourceDocument(inventory);
        const candidate = await this.readCandidate(input.tenantId, input.boardId, record);
        if (!yjsSemanticallyEqual(source, candidate)) throw new Error('SEMANTIC_MISMATCH');
        try { return report(await this.repository.markVerified(input.tenantId, input.boardId, record)); }
        catch (error) {
          if (!isCasLost(error)) throw error;
          const current = await this.repository.captureWatermark(input.tenantId, input.boardId);
          return report(await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, current));
        }
      }
      if (record.state === 'verified') {
        const watermark = await this.repository.captureWatermark(input.tenantId, input.boardId);
        const inventory = await this.repository.readInventory(input.tenantId, input.boardId, watermark);
        this.assertInventory(inventory);
        if (!this.sameWatermark(record, inventory)) return report(await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, inventory));
        const source = this.sourceDocument(inventory);
        const candidate = await this.readCandidate(input.tenantId, input.boardId, record);
        if (!yjsSemanticallyEqual(source, candidate)) throw new Error('SEMANTIC_MISMATCH');
        const retirementNotBefore = new Date(this.now().getTime() + this.rollbackWindowMs);
        try { return report(await this.repository.cutover(input.tenantId, input.boardId, record, retirementNotBefore)); }
        catch (error) {
          if (!isCasLost(error)) throw error;
          const current = await this.repository.captureWatermark(input.tenantId, input.boardId);
          return report(await this.repository.resetForChangedSource(input.tenantId, input.boardId, record, current));
        }
      }
      return report(record);
    } catch (error) {
      const code = errorCode(error);
      await this.repository.recordFailure(input.tenantId, input.boardId, input.jobId, code).catch(() => undefined);
      throw Object.assign(new Error(code), { code });
    }
  }

  private sameWatermark(record: BoardContentMigrationRecord, inventory: LegacyBoardWatermark): boolean {
    return inventory.storageKind === 'legacy_pg' && inventory.epoch === record.sourceEpoch
      && inventory.headSeq === record.sourceHeadSeq && inventory.fencingToken === record.sourceFencingToken;
  }

  private assertInventory(inventory: LegacyBoardInventory): void {
    if (!inventory.snapshot) throw new Error('LEGACY_SNAPSHOT_MISSING');
    if (inventory.updates.length !== inventory.headSeq) throw new Error('LEGACY_SEQUENCE_GAP');
    inventory.updates.forEach((update, index) => { if (update.seq !== index + 1) throw new Error('LEGACY_SEQUENCE_GAP'); });
  }

  private sourceDocument(inventory: LegacyBoardInventory): Uint8Array {
    if (!inventory.snapshot) throw new Error('LEGACY_SNAPSHOT_MISSING');
    return mergeLegacyYjsContent(inventory.snapshot, inventory.updates.map(update => update.update));
  }

  private async putAndVerify(tenantId: string, key: string, blob: EncodedBoardBlob): Promise<void> {
    await this.blobs.putImmutable({ tenantId, key, ciphertext: blob.ciphertext, cipherDigest: blob.cipherDigest, sizeBytes: blob.sizeBytes });
    const bytes = await this.blobs.getVerified({ tenantId, key, expectedCipherDigest: blob.cipherDigest, expectedSizeBytes: blob.sizeBytes });
    await this.codec.decrypt({ ...blob, tenantId, ciphertext: bytes, expectedPlainDigest: blob.plainDigest });
  }

  private async buildCandidate(tenantId: string, boardId: string, inventory: LegacyBoardInventory): Promise<BoardMigrationCandidate> {
    const checkpointBytes = this.sourceDocument(inventory);
    const checkpoint = await this.codec.encrypt({ tenantId, tenantKeyVersion: this.tenantKeyVersion, plaintext: checkpointBytes });
    const checkpointKey = boardBlobKey({ tenantId, boardId, kind: 'checkpoint', cipherDigest: checkpoint.cipherDigest });
    await this.putAndVerify(tenantId, checkpointKey, checkpoint);
    const manifest: BoardContentManifest = { manifestVersion: 1, boardId, epoch: inventory.epoch, headSeq: inventory.headSeq, schemaVersion: SCHEMA_VERSION,
      checkpoint: { key: checkpointKey, plainDigest: checkpoint.plainDigest, cipherDigest: checkpoint.cipherDigest, sizeBytes: checkpoint.sizeBytes, throughSeq: inventory.headSeq },
      tail: [], parentManifestDigest: null, tenantKeyVersion: this.tenantKeyVersion, createdAt: new Date().toISOString() };
    const encodedManifest = await this.codec.encrypt({ tenantId, tenantKeyVersion: this.tenantKeyVersion, plaintext: encodeBoardContentManifest(manifest) });
    const manifestKey = boardBlobKey({ tenantId, boardId, kind: 'manifest', cipherDigest: encodedManifest.cipherDigest });
    await this.putAndVerify(tenantId, manifestKey, encodedManifest);
    return { manifestKey, manifestDigest: encodedManifest.cipherDigest, manifestPlainDigest: encodedManifest.plainDigest,
      manifestSizeBytes: encodedManifest.sizeBytes, tenantKeyVersion: this.tenantKeyVersion };
  }

  private async readCandidate(tenantId: string, boardId: string, record: BoardContentMigrationRecord): Promise<Uint8Array> {
    const candidate = record.candidate;
    if (!candidate) throw new Error('CANDIDATE_MISSING');
    const encryptedManifest = await this.blobs.getVerified({ tenantId, key: candidate.manifestKey, expectedCipherDigest: candidate.manifestDigest, expectedSizeBytes: candidate.manifestSizeBytes });
    const manifestBytes = await this.codec.decrypt({ tenantId, tenantKeyVersion: candidate.tenantKeyVersion, ciphertext: encryptedManifest,
      cipherDigest: candidate.manifestDigest, plainDigest: candidate.manifestPlainDigest, expectedPlainDigest: candidate.manifestPlainDigest, sizeBytes: candidate.manifestSizeBytes });
    if (sha256(manifestBytes) !== candidate.manifestPlainDigest) throw new Error('CANDIDATE_MANIFEST_CORRUPT');
    const manifest = decodeBoardContentManifest(manifestBytes);
    if (manifest.boardId !== boardId || manifest.epoch !== record.sourceEpoch || manifest.headSeq !== record.sourceHeadSeq) throw new Error('CANDIDATE_MANIFEST_MISMATCH');
    const encryptedCheckpoint = await this.blobs.getVerified({ tenantId, key: manifest.checkpoint.key, expectedCipherDigest: manifest.checkpoint.cipherDigest, expectedSizeBytes: manifest.checkpoint.sizeBytes });
    return this.codec.decrypt({ tenantId, tenantKeyVersion: manifest.tenantKeyVersion, ciphertext: encryptedCheckpoint, cipherDigest: manifest.checkpoint.cipherDigest,
      plainDigest: manifest.checkpoint.plainDigest, expectedPlainDigest: manifest.checkpoint.plainDigest, sizeBytes: manifest.checkpoint.sizeBytes });
  }

  async verifyRetirementHead(tenantId: string, boardId: string, head: BoardRetirementHead): Promise<{ checkpointDigest: string }> {
    const encryptedManifest = await this.blobs.getVerified({ tenantId, key: head.manifestKey, expectedCipherDigest: head.manifestDigest, expectedSizeBytes: head.manifestSizeBytes });
    const manifestBytes = await this.codec.decrypt({ tenantId, tenantKeyVersion: head.tenantKeyVersion, ciphertext: encryptedManifest, cipherDigest: head.manifestDigest,
      plainDigest: head.manifestPlainDigest, expectedPlainDigest: head.manifestPlainDigest, sizeBytes: head.manifestSizeBytes });
    const manifest = decodeBoardContentManifest(manifestBytes);
    if (manifest.boardId !== boardId || manifest.epoch !== head.epoch || manifest.headSeq !== head.headSeq || manifest.tenantKeyVersion !== head.tenantKeyVersion) throw new Error('RETIREMENT_MANIFEST_MISMATCH');
    const checkpoint = await this.blobs.getVerified({ tenantId, key: manifest.checkpoint.key, expectedCipherDigest: manifest.checkpoint.cipherDigest, expectedSizeBytes: manifest.checkpoint.sizeBytes });
    await this.codec.decrypt({ tenantId, tenantKeyVersion: manifest.tenantKeyVersion, ciphertext: checkpoint, cipherDigest: manifest.checkpoint.cipherDigest,
      plainDigest: manifest.checkpoint.plainDigest, expectedPlainDigest: manifest.checkpoint.plainDigest, sizeBytes: manifest.checkpoint.sizeBytes });
    return { checkpointDigest: manifest.checkpoint.cipherDigest };
  }
}

export class RetireBoardContent {
  constructor(private readonly repository: BoardContentMigrationRepository, private readonly migration: MigrateBoardContent,
    private readonly proofKey: Uint8Array, private readonly cleanupBatchSize = 100, private readonly now: () => Date = () => new Date()) {}

  async step(input: { tenantId: string; boardId: string; jobId: string; credential: BoardRetirementCredential }): Promise<BoardContentMigrationReport> {
    try {
      let record = await this.repository.loadOrEnroll(input.tenantId, input.boardId, input.jobId);
      if (record.jobId !== input.jobId || !['cutover', 'cleaning', 'completed'].includes(record.state)) throw Object.assign(new Error('RETIREMENT_NOT_READY'), { code: 'RETIREMENT_NOT_READY' });
      if (record.state === 'completed') return report(record);
      const now = this.now();
      if (!record.retirementNotBefore || now.getTime() < Date.parse(record.retirementNotBefore)) throw Object.assign(new Error('ROLLBACK_WINDOW_ACTIVE'), { code: 'ROLLBACK_WINDOW_ACTIVE' });
      if (record.state === 'cutover') {
        const head = await this.repository.captureRetirementHead(input.tenantId, input.boardId);
        const verified = await this.migration.verifyRetirementHead(input.tenantId, input.boardId, head);
        const proof = verifyBoardRetirementCredential(input.credential, { tenantId: input.tenantId, boardId: input.boardId, jobId: input.jobId, manifestDigest: head.manifestDigest, checkpointDigest: verified.checkpointDigest }, this.proofKey, now);
        record = await this.repository.beginRetirement(input.tenantId, input.boardId, record, head, verified.checkpointDigest, proof.digest, now);
      } else {
        if (!record.retirementManifestDigest || !record.retirementCheckpointDigest || !record.retirementProofDigest) throw Object.assign(new Error('RETIREMENT_RECEIPT_MISSING'), { code: 'RETIREMENT_RECEIPT_MISSING' });
        const proof = verifyBoardRetirementCredential(input.credential, { tenantId: input.tenantId, boardId: input.boardId, jobId: input.jobId,
          manifestDigest: record.retirementManifestDigest, checkpointDigest: record.retirementCheckpointDigest }, this.proofKey, now);
        if (record.retirementProofDigest !== proof.digest) throw Object.assign(new Error('RETIREMENT_PROOF_CHANGED'), { code: 'RETIREMENT_PROOF_CHANGED' });
      }
      return report(await this.repository.cleanupBatch(input.tenantId, input.boardId, record, this.cleanupBatchSize));
    } catch (error) {
      const code = errorCode(error);
      await this.repository.recordFailure(input.tenantId, input.boardId, input.jobId, code).catch(() => undefined);
      throw Object.assign(new Error(code), { code });
    }
  }
}
