import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardBlobError } from '../../src/application/whiteboard/blob-ports';
import { boardBlobKey, sha256 } from '../../src/domain/whiteboard/blob-identity';
import { FsBoardBlobStore } from '../../src/infrastructure/whiteboard/fs-board-blob-store';

const tenantId = 'org-board-blob-a';
const otherTenantId = 'org-board-blob-b';
const boardId = '0199aabb-ccdd-7eef-8abc-0123456789ab';
let root = '';
let store: FsBoardBlobStore;

function input(bytes: Uint8Array, key = boardBlobKey({ tenantId, boardId, kind: 'update', cipherDigest: sha256(bytes) })) {
  return { tenantId, key, ciphertext: bytes, cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength };
}

function objectPath(key: string): string { return join(root, ...key.split('/')); }

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'wsx-board-blob-')); store = new FsBoardBlobStore(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('FsBoardBlobStore', () => {
  it('survives adapter restart and makes an identical replay idempotent', async () => {
    const value = input(Buffer.from('encrypted-board-update'));
    expect(await store.putImmutable(value)).toBe('created');
    const restarted = new FsBoardBlobStore(root);
    expect(await restarted.putImmutable(value)).toBe('already-present-same-content');
    expect(Buffer.from(await restarted.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).toString()).toBe('encrypted-board-update');
    expect(await restarted.head(value)).toEqual({ cipherDigest: value.cipherDigest, sizeBytes: value.sizeBytes });
  });

  it('publishes exactly one winner for concurrent different content at one immutable key', async () => {
    const left = input(Buffer.from('left'));
    const rightBytes = Buffer.from('right');
    const right = { ...left, ciphertext: rightBytes, cipherDigest: sha256(rightBytes), sizeBytes: rightBytes.byteLength };
    const result = await Promise.allSettled([store.putImmutable(left), store.putImmutable(right)]);
    expect(result.filter(entry => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find(entry => entry.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'INVALID_INPUT' } });
    expect((await readFile(objectPath(left.key))).toString()).toBe('left');
  });

  it('fails closed on truncation and tampering', async () => {
    const value = input(Buffer.from('ciphertext-with-a-tag'));
    await store.putImmutable(value);
    await truncate(objectPath(value.key), 4);
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await writeFile(objectPath(value.key), Buffer.alloc(value.sizeBytes, 42));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(store.putImmutable(value)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
  });

  it('rejects tenant confusion, traversal, empty segments, backslashes, NUL and absolute paths on every operation', async () => {
    const value = input(Buffer.from('safe'));
    const badKeys = ['../escape', '/absolute', `${value.key}//empty`, `${value.key}/../escape`, `${value.key}\\escape`, `${value.key}\0suffix`];
    for (const key of badKeys) {
      await expect(store.putImmutable({ ...value, key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(store.getVerified({ tenantId, key, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(store.head({ tenantId, key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(store.putImmutable({ ...value, tenantId: otherTenantId })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.getVerified({ tenantId: otherTenantId, key: value.key, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.head({ tenantId: otherTenantId, key: value.key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects forged digest and size before creating a visible object', async () => {
    const value = input(Buffer.from('actual'));
    await expect(store.putImmutable({ ...value, cipherDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.putImmutable({ ...value, sizeBytes: value.sizeBytes + 1 })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(await store.head(value)).toBeNull();
  });

  it('does not expose or depend on stale temporary files after restart', async () => {
    const value = input(Buffer.from('recoverable'));
    const parent = join(root, ...value.key.split('/').slice(0, -1));
    await import('node:fs/promises').then(fs => fs.mkdir(parent, { recursive: true }));
    await writeFile(join(parent, '.board-tmp-stale'), 'partial');
    const restarted = new FsBoardBlobStore(root);
    expect(await restarted.head(value)).toBeNull();
    expect(await restarted.putImmutable(value)).toBe('created');
  });

  it('uses typed missing and validation errors', async () => {
    const value = input(Buffer.from('missing'));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toEqual(expect.any(BoardBlobError));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
