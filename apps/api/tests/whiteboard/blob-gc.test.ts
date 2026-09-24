import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, type BoardBlobCodec, type BoardBlobPurgeCandidate, type BoardBlobPurgeStore, type BoardBlobStore, type EncodedBoardBlob } from '../../src/application/whiteboard/blob-ports';
import { SweepBoardBlobs, type BoardBlobReferenceGuard, type BoardManifestRoot } from '../../src/application/whiteboard/blob-gc';
import { boardBlobKey, sha256 } from '../../src/domain/whiteboard/blob-identity';
import { encodeBoardContentManifest } from '../../src/domain/whiteboard/content-manifest';

const tenantId = 'gc-tenant-a', otherTenantId = 'gc-tenant-b', boardId = randomUUID();
const old = new Date('2020-01-01T00:00:00.000Z'), cutoff = new Date('2021-01-01T00:00:00.000Z');

const codec: BoardBlobCodec = {
  async encrypt({ plaintext, tenantKeyVersion }): Promise<EncodedBoardBlob> {
    const ciphertext = new Uint8Array(plaintext), digest = sha256(ciphertext);
    return { ciphertext, plainDigest: digest, cipherDigest: digest, sizeBytes: ciphertext.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, tenantKeyVersion };
  },
  async decrypt(input) {
    if (input.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE || sha256(input.ciphertext) !== input.cipherDigest || sha256(input.ciphertext) !== input.expectedPlainDigest) throw new Error('integrity');
    return new Uint8Array(input.ciphertext);
  },
};

class MemoryBlobs implements BoardBlobStore, BoardBlobPurgeStore {
  readonly values = new Map<string, { tenantId: string; boardId: string; bytes: Uint8Array; createdAt: Date }>();
  async putImmutable(input: Parameters<BoardBlobStore['putImmutable']>[0]) {
    if (input.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE) throw new Error('mime');
    const match = input.key.match(/\/boards\/([^/]+)\//); if (!match) throw new Error('key');
    this.values.set(input.key, { tenantId: input.tenantId, boardId: match[1]!, bytes: new Uint8Array(input.ciphertext), createdAt: old });
    return 'created' as const;
  }
  async getVerified(input: Parameters<BoardBlobStore['getVerified']>[0]) {
    const value = this.values.get(input.key);
    if (!value || value.tenantId !== input.tenantId || input.expectedContentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE || sha256(value.bytes) !== input.expectedCipherDigest || value.bytes.byteLength !== input.expectedSizeBytes) throw new Error('integrity');
    return new Uint8Array(value.bytes);
  }
  async head(input: Parameters<BoardBlobStore['head']>[0]) {
    const value = this.values.get(input.key); if (!value || value.tenantId !== input.tenantId) return null;
    return { cipherDigest: sha256(value.bytes), sizeBytes: value.bytes.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE };
  }
  async listPurgeCandidates(input: Parameters<BoardBlobPurgeStore['listPurgeCandidates']>[0]) {
    const all = [...this.values.entries()].filter(([key, value]) => value.tenantId === input.tenantId && value.boardId === input.boardId
      && value.createdAt <= input.createdBefore && (input.cursor === undefined || key > input.cursor)).sort(([a], [b]) => a.localeCompare(b));
    const page = all.slice(0, input.limit);
    const candidates = page.map(([key, value]): BoardBlobPurgeCandidate => ({ tenantId: value.tenantId, key, cipherDigest: sha256(value.bytes), sizeBytes: value.bytes.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, createdAt: value.createdAt }));
    return { candidates, ...(all.length > page.length ? { nextCursor: page.at(-1)![0] } : {}) };
  }
  async purgeCandidate(input: Parameters<BoardBlobPurgeStore['purgeCandidate']>[0]) {
    const value = this.values.get(input.key); if (!value) return 'not-found' as const;
    if (value.tenantId !== input.tenantId || value.createdAt.getTime() !== input.createdAt.getTime() || value.createdAt > input.createdBefore
      || sha256(value.bytes) !== input.cipherDigest || value.bytes.byteLength !== input.sizeBytes) return 'changed-or-too-new' as const;
    this.values.delete(input.key); return 'deleted' as const;
  }
}

async function put(store: MemoryBlobs, kind: 'checkpoint' | 'manifest', bytes: Uint8Array): Promise<BoardManifestRoot> {
  const encoded = await codec.encrypt({ tenantId, tenantKeyVersion: 1, plaintext: bytes });
  const key = boardBlobKey({ tenantId, boardId, kind, cipherDigest: encoded.cipherDigest });
  await store.putImmutable({ tenantId, key, ...encoded });
  return { key, cipherDigest: encoded.cipherDigest, plainDigest: encoded.plainDigest, sizeBytes: encoded.sizeBytes, tenantKeyVersion: 1 };
}

async function manifest(store: MemoryBlobs, checkpoint: BoardManifestRoot, seq: number, parent: BoardManifestRoot | null, includeParentPointer = true): Promise<BoardManifestRoot> {
  const bytes = encodeBoardContentManifest({
    manifestVersion: 1, boardId, epoch: 1, headSeq: seq, schemaVersion: 1,
    checkpoint: { key: checkpoint.key, plainDigest: checkpoint.plainDigest, cipherDigest: checkpoint.cipherDigest, sizeBytes: checkpoint.sizeBytes, throughSeq: seq },
    tail: [], parentManifestDigest: parent?.cipherDigest ?? null,
    ...(parent && includeParentPointer ? { parentManifest: parent } : {}),
    tenantKeyVersion: 1, createdAt: '2020-01-01T00:00:00.000Z',
  });
  return put(store, 'manifest', bytes);
}

const guard = (roots: readonly BoardManifestRoot[]): BoardBlobReferenceGuard => ({
  async withLockedManifestRoots(_input, inspect) { return inspect(roots); },
});

describe('Board blob mark-and-sweep', () => {
  it('retains the active manifest/checkpoint and transitive history while reclaiming failed CAS/commit and crash-window blobs', async () => {
    const store = new MemoryBlobs();
    const parentCheckpoint = await put(store, 'checkpoint', Buffer.from('active-parent'));
    const parent = await manifest(store, parentCheckpoint, 1, null);
    const activeCheckpoint = await put(store, 'checkpoint', Buffer.from('active-current'));
    const active = await manifest(store, activeCheckpoint, 2, parent);
    const failedCheckpoint = await put(store, 'checkpoint', Buffer.from('fresh-nonce-orphan'));
    const failedManifest = await manifest(store, failedCheckpoint, 3, active);
    const crashOnlyCheckpoint = await put(store, 'checkpoint', Buffer.from('crash-before-manifest'));

    const result = await new SweepBoardBlobs(store, store, codec, guard([active])).run({ tenantId, boardId, createdBefore: cutoff, limit: 100 });
    expect(result).toMatchObject({ examined: 7, deleted: 3, retained: 4, changed: 0 });
    for (const live of [parentCheckpoint, parent, activeCheckpoint, active]) expect(store.values.has(live.key)).toBe(true);
    for (const orphan of [failedCheckpoint, failedManifest, crashOnlyCheckpoint]) expect(store.values.has(orphan.key)).toBe(false);
  });

  it('fails closed for legacy digest-only history and never deletes while reachability is unprovable', async () => {
    const store = new MemoryBlobs();
    const historicalCheckpoint = await put(store, 'checkpoint', Buffer.from('legacy-history'));
    const historical = await manifest(store, historicalCheckpoint, 1, null);
    const currentCheckpoint = await put(store, 'checkpoint', Buffer.from('legacy-current'));
    const current = await manifest(store, currentCheckpoint, 2, historical, false);
    const orphan = await put(store, 'checkpoint', Buffer.from('must-remain-on-fail-closed'));
    await expect(new SweepBoardBlobs(store, store, codec, guard([current])).run({ tenantId, boardId, createdBefore: cutoff, limit: 100 })).rejects.toThrow('LEGACY_HISTORY_UNVERIFIABLE');
    expect(store.values.has(orphan.key)).toBe(true);
  });

  it('honors grace, tenant isolation and a retry root observed under the Board lock', async () => {
    const store = new MemoryBlobs();
    const retryCheckpoint = await put(store, 'checkpoint', Buffer.from('concurrent-retry'));
    const retry = await manifest(store, retryCheckpoint, 1, null);
    const tooNew = await put(store, 'checkpoint', Buffer.from('inside-grace'));
    store.values.get(tooNew.key)!.createdAt = new Date('2022-01-01T00:00:00.000Z');
    const otherBytes = Buffer.from('other-tenant');
    const otherDigest = sha256(otherBytes), otherKey = boardBlobKey({ tenantId: otherTenantId, boardId, kind: 'checkpoint', cipherDigest: otherDigest });
    store.values.set(otherKey, { tenantId: otherTenantId, boardId, bytes: otherBytes, createdAt: old });
    const result = await new SweepBoardBlobs(store, store, codec, guard([retry])).run({ tenantId, boardId, createdBefore: cutoff, limit: 100 });
    expect(result).toMatchObject({ examined: 2, retained: 2, deleted: 0 });
    expect(store.values.has(tooNew.key)).toBe(true); expect(store.values.has(otherKey)).toBe(true);
  });
});
