import { mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function directoryChain(storageRoot: string, key: string): string[] {
  const chain = [storageRoot];
  for (const segment of key.split('/').slice(0, -1)) chain.push(join(chain.at(-1)!, segment));
  return chain;
}

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

  it('durably creates every directory level before publishing into an empty root', async () => {
    const syncs: string[] = [];
    const audited = new FsBoardBlobStore(root, async path => { syncs.push(path); });
    const value = input(Buffer.from('first-multi-level-write'));
    const chain = directoryChain(root, value.key);
    const creation = chain.slice(1).flatMap((directory, index) => [directory, chain[index]!]);
    const recoverySweep = [...chain].reverse().concat(dirname(root));
    expect(await audited.putImmutable(value)).toBe('created');
    expect(syncs).toEqual([...creation, ...recoverySweep, chain.at(-1)!]);
  });

  it('does not ACK any directory fsync failure and recovers on retry', async () => {
    const value = input(Buffer.from('directory-fsync-recovery'));
    const levels = value.key.split('/').length - 1;
    const directorySyncs = levels * 2 + (levels + 1) + 1;
    for (let failAt = 1; failAt <= directorySyncs; failAt++) {
      const caseRoot = await mkdtemp(join(tmpdir(), 'wsx-board-dir-fault-'));
      let calls = 0;
      const faulted = new FsBoardBlobStore(caseRoot, async () => {
        calls++;
        if (calls === failAt) throw Object.assign(new Error('injected directory fsync failure'), { code: 'EIO' });
      });
      try {
        await expect(faulted.putImmutable(value)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
        await expect(faulted.putImmutable(value)).resolves.toBe('created');
      } finally {
        await rm(caseRoot, { recursive: true, force: true });
      }
    }
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

  it('handles concurrent directory EEXIST and identical immutable publication', async () => {
    const value = input(Buffer.from('same-concurrent-content'));
    const results = await Promise.all([store.putImmutable(value), store.putImmutable(value)]);
    expect(results.sort()).toEqual(['already-present-same-content', 'created']);
    expect(await readFile(objectPath(value.key))).toEqual(Buffer.from(value.ciphertext));
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

  it('refuses a symlink inside the tenant directory chain', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'wsx-board-outside-'));
    try {
      await symlink(outside, join(root, 'tenants'));
      await expect(store.putImmutable(input(Buffer.from('must-stay-inside-root')))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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

  it('retries parent directory fsync before an EEXIST replay can report success', async () => {
    const value = input(Buffer.from('linked-before-directory-sync'));
    const chain = directoryChain(root, value.key);
    const parent = chain.at(-1)!;
    await mkdir(parent, { recursive: true });
    const prepareSyncs = chain.length + 1;
    let syncAttempts = 0;
    const faulted = new FsBoardBlobStore(root, async () => {
      syncAttempts++;
      if (syncAttempts === prepareSyncs + 1) throw Object.assign(new Error('injected directory fsync failure'), { code: 'EIO' });
    });
    await expect(faulted.putImmutable(value)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(await readFile(objectPath(value.key))).toEqual(Buffer.from(value.ciphertext));
    expect(await faulted.putImmutable(value)).toBe('already-present-same-content');
    expect(syncAttempts).toBe(prepareSyncs * 2 + 2);
  });

  it('uses typed missing and validation errors', async () => {
    const value = input(Buffer.from('missing'));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toEqual(expect.any(BoardBlobError));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
