import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { BoardBlobCodec, BoardBlobStore, EncodedBoardBlob } from '../../src/application/whiteboard/blob-ports';
import type { BoardContentMigrationRecord, BoardContentMigrationRepository, BoardMigrationCandidate, LegacyBoardInventory } from '../../src/application/whiteboard/content-migration-ports';
import { MigrateBoardContent } from '../../src/application/whiteboard/migrate-board-content';
import { sha256 } from '../../src/domain/whiteboard/blob-identity';
import { yjsSemanticallyEqual } from '../../src/domain/whiteboard/yjs-semantic-equivalence';

const tenantId = 'migration-org', boardId = randomUUID(), jobId = randomUUID();

function fixture(): { inventory: LegacyBoardInventory; expected: Uint8Array } {
  const doc = new Y.Doc();
  doc.getMap('objects').set('note-1', { text: '中文便利贴', color: 'yellow' });
  const snapshot = Y.encodeStateAsUpdate(doc);
  let deletion: Uint8Array = new Uint8Array();
  doc.on('update', update => { deletion = update; });
  doc.transact(() => {
    doc.getMap('objects').delete('note-1');
    doc.getMap('objects').set('drawing-1', { points: [1, 2, 3], label: '保留' });
  });
  const expected = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return { inventory: { epoch: 3, headSeq: 1, fencingToken: 9, storageKind: 'legacy_pg', snapshot, updates: [{ seq: 1, update: deletion }] }, expected };
}

class MemoryBlobs implements BoardBlobStore {
  values = new Map<string, Uint8Array>();
  corruptReads = false;
  async putImmutable(input: Parameters<BoardBlobStore['putImmutable']>[0]) {
    const current = this.values.get(input.key);
    if (current) {
      if (sha256(current) !== input.cipherDigest) throw new Error('immutable conflict');
      return 'already-present-same-content' as const;
    }
    this.values.set(input.key, new Uint8Array(input.ciphertext));
    return 'created' as const;
  }
  async getVerified(input: Parameters<BoardBlobStore['getVerified']>[0]) {
    const value = this.values.get(input.key);
    if (!value) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    const bytes = this.corruptReads ? new Uint8Array([...value.slice(0, -1), (value.at(-1) ?? 0) ^ 1]) : new Uint8Array(value);
    if (sha256(bytes) !== input.expectedCipherDigest || bytes.byteLength !== input.expectedSizeBytes) throw Object.assign(new Error('corrupt'), { code: 'INTEGRITY_FAILED' });
    return bytes;
  }
  async head(input: Parameters<BoardBlobStore['head']>[0]) {
    const value = this.values.get(input.key);
    return value ? { cipherDigest: sha256(value), sizeBytes: value.byteLength } : null;
  }
}

class DeferredBlobs extends MemoryBlobs {
  private releaseUpload!: () => void;
  readonly uploadStarted = new Promise<void>(resolve => { this.releaseUpload = resolve; });
  private continueUpload!: () => void;
  private readonly uploadGate = new Promise<void>(resolve => { this.continueUpload = resolve; });
  override async putImmutable(input: Parameters<BoardBlobStore['putImmutable']>[0]) {
    this.releaseUpload();
    await this.uploadGate;
    return super.putImmutable(input);
  }
  release() { this.continueUpload(); }
}

const codec: BoardBlobCodec = {
  async encrypt({ plaintext, tenantKeyVersion }): Promise<EncodedBoardBlob> {
    const ciphertext = new Uint8Array(plaintext), digest = sha256(ciphertext);
    return { ciphertext, plainDigest: digest, cipherDigest: digest, sizeBytes: ciphertext.byteLength, tenantKeyVersion };
  },
  async decrypt(input) {
    if (sha256(input.ciphertext) !== input.cipherDigest || sha256(input.ciphertext) !== input.expectedPlainDigest) throw Object.assign(new Error('corrupt'), { code: 'INTEGRITY_FAILED' });
    return new Uint8Array(input.ciphertext);
  },
};

class MemoryRepository implements BoardContentMigrationRepository {
  readonly receipts = new Set(['original-request-id']);
  record: BoardContentMigrationRecord | null = null;
  storageKind: 'legacy_pg' | 'blob_primary' = 'legacy_pg';
  legacyBytesPresent = true;
  constructor(public source: LegacyBoardInventory) {}
  async loadOrEnroll(_tenant: string, _board: string, requestedJob: string) {
    this.record ??= { jobId: requestedJob, state: 'enrolled', sourceEpoch: this.source.epoch, sourceHeadSeq: this.source.headSeq, sourceFencingToken: this.source.fencingToken, candidate: null, cleanupThroughSeq: 0, attempts: 0, lastErrorCode: null };
    this.record = { ...this.record, attempts: this.record.attempts + 1, lastErrorCode: null };
    return structuredClone(this.record);
  }
  async captureInventory() { return structuredClone({ ...this.source, storageKind: this.storageKind, snapshot: this.legacyBytesPresent ? this.source.snapshot : null, updates: this.source.updates.map(update => ({ ...update, update: new Uint8Array(update.update) })) }); }
  async saveCandidate(_tenant: string, _board: string, current: BoardContentMigrationRecord, candidate: BoardMigrationCandidate) { this.assertWatermark(current); return this.set({ state: 'candidate_ready', candidate }); }
  async markVerified(_tenant: string, _board: string, current: BoardContentMigrationRecord) { this.assertWatermark(current); return this.set({ state: 'verified' }); }
  async cutover(_tenant: string, _board: string, current: BoardContentMigrationRecord) { this.assertWatermark(current); this.storageKind = 'blob_primary'; return this.set({ state: 'cutover' }); }
  async cleanupBatch() { this.legacyBytesPresent = false; return this.set({ state: 'completed', cleanupThroughSeq: this.source.headSeq }); }
  async resetForChangedSource(_tenant: string, _board: string, _record: BoardContentMigrationRecord, source: LegacyBoardInventory) { return this.set({ state: 'enrolled', sourceEpoch: source.epoch, sourceHeadSeq: source.headSeq, sourceFencingToken: source.fencingToken, candidate: null, cleanupThroughSeq: 0, lastErrorCode: 'WATERMARK_CHANGED' }); }
  async recordFailure(_tenant: string, _board: string, requestedJob: string, code: string) {
    if (this.record?.jobId === requestedJob && !['cutover', 'cleaning', 'completed'].includes(this.record.state)) this.record = { ...this.record, attempts: this.record.attempts + 1, lastErrorCode: code };
  }
  private set(patch: Partial<BoardContentMigrationRecord>): BoardContentMigrationRecord {
    if (!this.record) throw new Error('not enrolled');
    this.record = { ...this.record, ...patch };
    return structuredClone(this.record);
  }
  private assertWatermark(current: BoardContentMigrationRecord) {
    if (this.storageKind !== 'legacy_pg' || current.sourceEpoch !== this.source.epoch || current.sourceHeadSeq !== this.source.headSeq || current.sourceFencingToken !== this.source.fencingToken) throw new Error('WHITEBOARD_MIGRATION_CAS_LOST');
  }
}

describe('online legacy PG to Board blob migration', () => {
  it('accepts independently merged Yjs documents by semantic evidence', () => {
    const leftClient = new Y.Doc(), rightClient = new Y.Doc();
    leftClient.clientID = 101; rightClient.clientID = 202;
    leftClient.getMap('objects').set('left', { text: '甲' });
    rightClient.getMap('objects').set('right', { text: '乙' });
    const left = Y.encodeStateAsUpdate(leftClient), right = Y.encodeStateAsUpdate(rightClient);
    const encodedAB = Y.mergeUpdates([left, right]), encodedBA = Y.mergeUpdates([right, left]);
    expect(yjsSemanticallyEqual(encodedAB, encodedBA)).toBe(true);
    leftClient.destroy(); rightClient.destroy();
  });

  it('resumes after every phase and preserves Chinese content plus Yjs deletion sets', async () => {
    const { inventory, expected } = fixture(), repository = new MemoryRepository(inventory), blobs = new MemoryBlobs();
    const states: string[] = [];
    for (let process = 0; process < 5; process++) {
      const restarted = new MigrateBoardContent(repository, blobs, codec, 1, 1);
      const result = await restarted.step({ tenantId, boardId, jobId });
      states.push(result.state);
      if (result.state === 'completed') break;
    }
    expect(states).toEqual(['candidate_ready', 'verified', 'cutover', 'completed']);
    expect(repository.storageKind).toBe('blob_primary');
    expect(repository.legacyBytesPresent).toBe(false);
    expect(repository.receipts.has('original-request-id')).toBe(true);
    const candidate = repository.record?.candidate;
    expect(candidate).not.toBeNull();
    const manifestBytes = blobs.values.get(candidate!.manifestKey)!;
    const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as { checkpoint: { key: string } };
    expect(yjsSemanticallyEqual(blobs.values.get(manifest.checkpoint.key)!, expected)).toBe(true);
  });

  it('never cuts over when an immutable candidate is missing or corrupt', async () => {
    for (const failure of ['missing', 'corrupt'] as const) {
      const repository = new MemoryRepository(fixture().inventory), blobs = new MemoryBlobs(), service = new MigrateBoardContent(repository, blobs, codec, 1);
      await service.step({ tenantId, boardId, jobId });
      if (failure === 'missing') blobs.values.delete(repository.record!.candidate!.manifestKey);
      else blobs.corruptReads = true;
      await expect(service.step({ tenantId, boardId, jobId })).rejects.toMatchObject({ code: failure === 'missing' ? 'NOT_FOUND' : 'INTEGRITY_FAILED' });
      expect(repository.storageKind).toBe('legacy_pg');
      expect(repository.record?.state).toBe('candidate_ready');
    }
  });

  it('loses the candidate watermark CAS on a concurrent write, then retries without losing seq', async () => {
    const { inventory } = fixture(), repository = new MemoryRepository(inventory), blobs = new MemoryBlobs(), service = new MigrateBoardContent(repository, blobs, codec, 1);
    await service.step({ tenantId, boardId, jobId });
    const doc = new Y.Doc(); Y.applyUpdate(doc, inventory.snapshot!); inventory.updates.forEach(item => Y.applyUpdate(doc, item.update));
    let update: Uint8Array = new Uint8Array(); doc.on('update', value => { update = value; }); doc.getMap('objects').set('note-2', { text: '并发写' }); doc.destroy();
    repository.source = { ...repository.source, headSeq: 2, updates: [...repository.source.updates, { seq: 2, update }] };
    expect((await service.step({ tenantId, boardId, jobId })).state).toBe('enrolled');
    expect(repository.record?.sourceHeadSeq).toBe(2);
    for (let i = 0; i < 4 && repository.record?.state !== 'completed'; i++) await service.step({ tenantId, boardId, jobId });
    expect(repository.record).toMatchObject({ state: 'completed', sourceHeadSeq: 2, cleanupThroughSeq: 2 });
  });

  it('does not hold the Board database lock while blob upload is pending', async () => {
    const repository = new MemoryRepository(fixture().inventory), blobs = new DeferredBlobs(), service = new MigrateBoardContent(repository, blobs, codec, 1);
    const migration = service.step({ tenantId, boardId, jobId });
    await blobs.uploadStarted;
    // A collaboration transaction can advance the source watermark while cloud
    // I/O is stalled. The later short CAS rejects this candidate.
    repository.source = { ...repository.source, headSeq: 2, updates: [...repository.source.updates, { seq: 2, update: repository.source.updates[0]!.update }] };
    blobs.release();
    expect((await migration).state).toBe('enrolled');
    expect(repository.record?.state).toBe('enrolled');
    expect(repository.storageKind).toBe('legacy_pg');
  });

  it('rejects gaps and cross-job replay without publishing the primary pointer', async () => {
    const broken = fixture().inventory;
    broken.headSeq = 2;
    const repository = new MemoryRepository(broken), service = new MigrateBoardContent(repository, new MemoryBlobs(), codec, 1);
    await expect(service.step({ tenantId, boardId, jobId })).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    expect(repository.storageKind).toBe('legacy_pg');
    await expect(service.step({ tenantId, boardId, jobId: randomUUID() })).rejects.toMatchObject({ code: 'JOB_CONFLICT' });
  });
});
