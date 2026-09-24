import { chmod, link as hardlink, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, BoardBlobError } from '../../src/application/whiteboard/blob-ports';
import { boardBlobKey, sha256 } from '../../src/domain/whiteboard/blob-identity';
import { FsBoardBlobStore } from '../../src/infrastructure/whiteboard/fs-board-blob-store';

const tenantId = 'org-board-blob-a';
const otherTenantId = 'org-board-blob-b';
const boardId = '0199aabb-ccdd-7eef-8abc-0123456789ab';
let root = '';
let store: FsBoardBlobStore;

function input(bytes: Uint8Array, key = boardBlobKey({ tenantId, boardId, kind: 'update', cipherDigest: sha256(bytes) })) {
  return { tenantId, key, ciphertext: bytes, cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, expectedContentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE };
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
    expect(await restarted.head(value)).toEqual({ cipherDigest: value.cipherDigest, sizeBytes: value.sizeBytes, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE });
  });

  it('durably creates every directory level before publishing into an empty root', async () => {
    const syncs: string[] = [];
    const audited = new FsBoardBlobStore(root, async path => { syncs.push(path); });
    const value = input(Buffer.from('first-multi-level-write'));
    const chain = directoryChain(root, value.key);
    const creation = chain.slice(1).flatMap((directory, index) => [directory, chain[index]!]);
    const recoverySweep = [...chain].reverse().concat(dirname(root));
    expect(await audited.putImmutable(value)).toBe('created');
    expect(syncs).toEqual([root, ...creation, ...recoverySweep, chain.at(-1)!, chain.at(-1)!]);
  });

  it('creates and fsyncs every missing storage-root ancestor and repairs every injected layer failure', async () => {
    const value=input(Buffer.from('missing-root-ancestor-durability')),expectedRootSyncs=10;
    for(let failAt=0;failAt<=expectedRootSyncs;failAt++){
      const boundary=await mkdtemp(join(tmpdir(),'wsx-board-root-boundary-')),caseRoot=join(boundary,'one','two','blob-root');let calls=0;
      const faulted=new FsBoardBlobStore(caseRoot,async()=>{calls++;if(calls===failAt)throw Object.assign(new Error('injected root-chain fsync failure'),{code:'EIO'});});
      try{
        if(failAt>0)await expect(faulted.putImmutable(value)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
        await expect(faulted.putImmutable(value)).resolves.toBe('created');
        expect(await readFile(join(caseRoot,...value.key.split('/')))).toEqual(Buffer.from(value.ciphertext));
        for(const directory of [join(boundary,'one'),join(boundary,'one','two'),caseRoot]){
          const metadata=await stat(directory);expect(metadata.uid).toBe(process.getuid?.());expect(metadata.mode&0o022).toBe(0);
        }
      }finally{await rm(boundary,{recursive:true,force:true});}
    }
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

  it('serializes publication across adapter instances without deleting an active publisher temp', async () => {
    const value = input(Buffer.from('cross-adapter-concurrent-content'));
    const target = objectPath(value.key);
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    let releaseFirstPublisher!: () => void;
    const firstPublisherMayContinue = new Promise<void>(resolve => { releaseFirstPublisher = resolve; });
    let reportLinked!: () => void;
    const linked = new Promise<void>(resolve => { reportLinked = resolve; });
    let pausedAfterLink = false;
    const first = new FsBoardBlobStore(root, async path => {
      const targetIsVisible = await lstat(target).then(
        () => true,
        error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        },
      );
      if (!pausedAfterLink && path === parent && targetIsVisible) {
        pausedAfterLink = true;
        reportLinked();
        await firstPublisherMayContinue;
      }
    });
    const second = new FsBoardBlobStore(root, async () => undefined);
    const firstResult = first.putImmutable(value);
    await linked;
    let secondSettled = false;
    const secondResult = second.putImmutable(value).finally(() => { secondSettled = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(secondSettled).toBe(false);
    } finally {
      releaseFirstPublisher();
    }
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      'created',
      'already-present-same-content',
    ]);
    expect((await stat(target)).nlink).toBe(1);
    expect(await readFile(target)).toEqual(Buffer.from(value.ciphertext));
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
      await expect(store.getVerified({ tenantId, key, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes, expectedContentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(store.head({ tenantId, key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(store.putImmutable({ ...value, tenantId: otherTenantId })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.getVerified({ tenantId: otherTenantId, key: value.key, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes, expectedContentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.head({ tenantId: otherTenantId, key: value.key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a symlink inside the tenant directory chain', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'wsx-board-outside-'));
    try {
      await symlink(outside, join(root, 'tenants'));
      const value=input(Buffer.from('must-stay-inside-root'));
      await expect(store.putImmutable(value)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(store.getVerified({...value,expectedCipherDigest:value.cipherDigest,expectedSizeBytes:value.sizeBytes})).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.head(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.each([['same',Buffer.from('outside-ciphertext')],['different',Buffer.from('different-outside-ciphertext')]])('rejects a terminal symlink to %s external content on put/get/head',async(_kind,outsideBytes)=>{
    const value=input(Buffer.from('outside-ciphertext')),parent=dirname(objectPath(value.key)),outsideDir=await mkdtemp(join(tmpdir(),'wsx-board-target-symlink-')),outside=join(outsideDir,'external');
    try{
      await mkdir(parent,{recursive:true});await writeFile(outside,outsideBytes);await symlink(outside,objectPath(value.key));
      await expect(store.putImmutable(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.getVerified({...value,expectedCipherDigest:value.cipherDigest,expectedSizeBytes:value.sizeBytes})).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.head(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(await readFile(outside)).toEqual(outsideBytes);
    }finally{await rm(outsideDir,{recursive:true,force:true});}
  });

  it('rejects a same-content external hardlink and never treats externally mutable bytes as acknowledged',async()=>{
    const value=input(Buffer.from('hardlinked-outside-content')),parent=dirname(objectPath(value.key)),outsideDir=await mkdtemp(join(tmpdir(),'wsx-board-target-hardlink-')),outside=join(outsideDir,'external');
    try{
      await mkdir(parent,{recursive:true});await writeFile(outside,value.ciphertext,{mode:0o600});await hardlink(outside,objectPath(value.key));
      await expect(store.putImmutable(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.getVerified({...value,expectedCipherDigest:value.cipherDigest,expectedSizeBytes:value.sizeBytes})).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.head(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      await writeFile(outside,Buffer.alloc(value.sizeBytes,42));
      await expect(store.getVerified({...value,expectedCipherDigest:value.cipherDigest,expectedSizeBytes:value.sizeBytes})).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await rm(outsideDir,{recursive:true,force:true});}
  });

  it('fails fast when an existing storage root is group writable',async()=>{
    const value=input(Buffer.from('unsafe-root'));
    await chmod(root,0o770);
    try{
      await expect(store.putImmutable(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.getVerified({...value,expectedCipherDigest:value.cipherDigest,expectedSizeBytes:value.sizeBytes})).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(store.head(value)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await chmod(root,0o700);}
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

  it('removes a crashed publisher temporary hardlink before accepting an immutable replay',async()=>{
    const value=input(Buffer.from('crashed-publisher-hardlink')),target=objectPath(value.key),parent=dirname(target);
    await mkdir(parent,{recursive:true});await writeFile(target,value.ciphertext,{mode:0o600});await hardlink(target,join(parent,'.board-tmp-crashed-publisher'));
    expect((await stat(target)).nlink).toBe(2);
    expect(await store.putImmutable(value)).toBe('already-present-same-content');
    expect((await stat(target)).nlink).toBe(1);
  });

  it('retries parent directory fsync before an EEXIST replay can report success', async () => {
    const value = input(Buffer.from('linked-before-directory-sync'));
    const chain = directoryChain(root, value.key);
    const parent = chain.at(-1)!;
    await mkdir(parent, { recursive: true });
    let syncAttempts = 0,failed=false,parentSyncsAfterPublish=0;
    const faulted = new FsBoardBlobStore(root, async path => {
      syncAttempts++;
      const published=await lstat(objectPath(value.key)).then(()=>true,error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;});
      if(path===parent&&published){parentSyncsAfterPublish++;if(!failed){failed=true;throw Object.assign(new Error('injected directory fsync failure'), { code: 'EIO' });}}
    });
    await expect(faulted.putImmutable(value)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(await readFile(objectPath(value.key))).toEqual(Buffer.from(value.ciphertext));
    const syncsBeforeRetry=parentSyncsAfterPublish;
    expect(await faulted.putImmutable(value)).toBe('already-present-same-content');
    expect(syncAttempts).toBeGreaterThan(chain.length * 2);
    expect(parentSyncsAfterPublish).toBeGreaterThan(syncsBeforeRetry);
  });

  it('uses typed missing and validation errors', async () => {
    const value = input(Buffer.from('missing'));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toEqual(expect.any(BoardBlobError));
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pins the encrypted-object MIME across put, get, head and rejects mismatched metadata', async () => {
    const value = input(Buffer.from('opaque-ciphertext'));
    await expect(store.putImmutable({ ...value, contentType: 'text/plain' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await store.putImmutable(value);
    await expect(store.getVerified({ ...value, expectedCipherDigest: value.cipherDigest, expectedSizeBytes: value.sizeBytes, expectedContentType: 'text/plain' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await store.head(value)).toMatchObject({ contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE });
  });

  it('enumerates old candidates by tenant and board in bounded pages and purges only an unchanged watermark', async () => {
    const first = input(Buffer.from('gc-first'));
    const second = input(Buffer.from('gc-second'));
    await store.putImmutable(first); await store.putImmutable(second);
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(objectPath(first.key), old, old); await utimes(objectPath(second.key), old, old);
    const page1 = await store.listPurgeCandidates({ tenantId, boardId, createdBefore: new Date('2021-01-01T00:00:00.000Z'), limit: 1 });
    expect(page1.candidates).toHaveLength(1); expect(page1.nextCursor).toBeTruthy();
    const page2 = await store.listPurgeCandidates({ tenantId, boardId, createdBefore: new Date('2021-01-01T00:00:00.000Z'), limit: 1, cursor: page1.nextCursor });
    expect(page2.candidates).toHaveLength(1);
    await expect(store.purgeCandidate({ ...page1.candidates[0]!, createdBefore: new Date('2019-01-01T00:00:00.000Z') })).resolves.toBe('changed-or-too-new');
    await expect(store.purgeCandidate({ ...page1.candidates[0]!, createdBefore: new Date('2021-01-01T00:00:00.000Z') })).resolves.toBe('deleted');
    await expect(store.purgeCandidate({ ...page1.candidates[0]!, createdBefore: new Date('2021-01-01T00:00:00.000Z') })).resolves.toBe('not-found');
    expect(await store.head(page1.candidates[0]!)).toBeNull();
  });

  it('never enumerates another tenant/board and rejects purge traversal and changed candidates', async () => {
    const value = input(Buffer.from('tenant-isolated-gc'));
    await store.putImmutable(value);
    const metadata = await lstat(objectPath(value.key));
    const candidate = { tenantId, key: value.key, cipherDigest: value.cipherDigest, sizeBytes: value.sizeBytes, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, createdAt: metadata.mtime };
    expect((await store.listPurgeCandidates({ tenantId: otherTenantId, boardId, createdBefore: new Date(Date.now() + 1_000), limit: 10 })).candidates).toEqual([]);
    await expect(store.purgeCandidate({ ...candidate, key: '../escape', createdBefore: new Date(Date.now() + 1_000) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.purgeCandidate({ ...candidate, cipherDigest: '0'.repeat(64), createdBefore: new Date(Date.now() + 1_000) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await store.head(value)).not.toBeNull();
  });
});
