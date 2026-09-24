import { describe, expect, it } from 'vitest';
import { boardBlobKey, sha256 } from '../../src/domain/whiteboard/blob-identity';
import {
  HostedBoardBlobStore,
  OssBoardBlobStore,
  S3CompatibleBoardBlobStore,
  type HostedBoardBlobClient,
  type HostedBoardBlobObject,
  type HostedBoardBucketPolicy,
} from '../../src/infrastructure/whiteboard/hosted-board-blob-store';

class MemoryHostedClient implements HostedBoardBlobClient {
  provider: 'aliyun-oss' | 's3-compatible' = 's3-compatible';
  policy: HostedBoardBucketPolicy = { access: 'private', versioning: 'enabled', objectLock: 'enabled' };
  readonly objects = new Map<string, HostedBoardBlobObject>();
  putFailure: Error | null = null;
  failBeforePut = 0;
  putCalls = 0;
  mutateAfterPut?: (object: HostedBoardBlobObject) => void;
  deleteFailure:Error|null=null;
  deleteCalls:Array<{key:string;versionId?:string}>=[];
  replacementAfterDelete?:HostedBoardBlobObject;
  async inspectBucket() { return this.policy; }
  async putIfAbsent(input: { key: string; bytes: Uint8Array; metadata: { cipherDigest: string; sizeBytes: number } }) {
    this.putCalls += 1;
    if (this.failBeforePut > 0) { this.failBeforePut -= 1; throw new Error('expired credential'); }
    if (this.objects.has(input.key)) return 'already-exists' as const;
    const object = { bytes: new Uint8Array(input.bytes), ...input.metadata,versionId:'version-1' };
    this.objects.set(input.key, object); this.mutateAfterPut?.(object);
    if (this.putFailure) throw this.putFailure;
    return 'created' as const;
  }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async head(key: string) {
    const value = this.objects.get(key);
    return value ? { cipherDigest: value.cipherDigest, sizeBytes: value.sizeBytes,versionId:value.versionId } : null;
  }
  async deleteCurrent(key:string,versionId?:string){
    this.deleteCalls.push({key,versionId});
    if(this.deleteFailure)throw this.deleteFailure;
    const current=this.objects.get(key);
    if(!current||current.versionId!==versionId)return 'not-found' as const;
    this.objects.delete(key);
    if(this.replacementAfterDelete)this.objects.set(key,this.replacementAfterDelete);
    return 'deleted' as const;
  }
}

const value = (tenantId = 'org-a', content = 'hosted board bytes') => {
  const ciphertext = Buffer.from(content), cipherDigest = sha256(ciphertext);
  return {
    tenantId,
    key: boardBlobKey({ tenantId, boardId: '11111111-1111-4111-8111-111111111111', kind: 'update', cipherDigest }),
    ciphertext: new Uint8Array(ciphertext), cipherDigest, sizeBytes: ciphertext.byteLength,
  };
};

describe.each(['aliyun-oss', 's3-compatible'] as const)('%s BoardBlobStore contract', provider => {
  const create = () => {
    const client = new MemoryHostedClient(); client.provider = provider;
    const store = provider === 'aliyun-oss'
      ? new OssBoardBlobStore(client, { requireObjectLock: true })
      : new S3CompatibleBoardBlobStore(client, { requireObjectLock: true });
    return { client, store };
  };

  it('creates, immediately verifies, survives recreation, and treats identical replay as idempotent', async () => {
    const { client, store } = create(); const input = value();
    expect(await store.putImmutable(input)).toBe('created');
    const restarted = provider === 'aliyun-oss'
      ? new OssBoardBlobStore(client, { requireObjectLock: true })
      : new S3CompatibleBoardBlobStore(client, { requireObjectLock: true });
    expect(await restarted.putImmutable(input)).toBe('already-present-same-content');
    expect(await restarted.getVerified({ ...input, expectedCipherDigest: input.cipherDigest, expectedSizeBytes: input.sizeBytes })).toEqual(input.ciphertext);
    expect(await restarted.head(input)).toEqual({ cipherDigest: input.cipherDigest, sizeBytes: input.sizeBytes });
  });

  it('rejects conflicting bytes, tampering, missing objects, and cross-tenant keys', async () => {
    const { client, store } = create(); const input = value();
    await store.putImmutable(input);
    const conflicting = value('org-a', 'different');
    conflicting.key = input.key;
    await expect(store.putImmutable(conflicting)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const existing = client.objects.get(input.key)!; existing.bytes[0]! ^= 1;
    await expect(store.getVerified({ ...input, expectedCipherDigest: input.cipherDigest, expectedSizeBytes: input.sizeBytes })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    const missing = value('org-a', 'missing');
    await expect(store.getVerified({ ...missing, expectedCipherDigest: missing.cipherDigest, expectedSizeBytes: missing.sizeBytes })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.head({ tenantId: 'org-b', key: input.key })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('detects conflicting content at an occupied content-addressed key', async () => {
    const { client, store } = create(); const input = value();
    client.objects.set(input.key, { bytes: Buffer.from('wrong'), cipherDigest: sha256(Buffer.from('wrong')), sizeBytes: 5 });
    await expect(store.putImmutable(input)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
  });

  it('resolves a timeout after a committed conditional put by verified readback', async () => {
    const { client, store } = create(); const input = value(); client.putFailure = new Error('secret credential timeout');
    await expect(store.putImmutable(input)).resolves.toBe('already-present-same-content');
  });

  it('makes one safe conditional retry after a pre-commit timeout', async () => {
    const { client, store } = create(); const input = value(); client.failBeforePut = 1;
    await expect(store.putImmutable(input)).resolves.toBe('created');
    expect(client.putCalls).toBe(2);
  });

  it('fails closed and sanitizes provider failures', async () => {
    const { client, store } = create(); const input = value();
    client.inspectBucket = async () => { throw new Error('AKIA-SECRET https://internal.example'); };
    await expect(store.putImmutable(input)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', message: 'hosted board storage is unavailable' });
  });

  it('deletes only the head-verified immutable object and leaves provider failures retryable',async()=>{
    const {client,store}=create(),input=value();await store.putImmutable(input);
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:'0'.repeat(64),expectedSizeBytes:input.sizeBytes})).rejects.toMatchObject({code:'INTEGRITY_FAILED'});
    expect(client.objects.has(input.key)).toBe(true);
    client.deleteFailure=new Error('object lock retained secret');
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:input.cipherDigest,expectedSizeBytes:input.sizeBytes})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(client.objects.has(input.key)).toBe(true);
    client.deleteFailure=null;
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:input.cipherDigest,expectedSizeBytes:input.sizeBytes})).resolves.toBe('deleted');
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:input.cipherDigest,expectedSizeBytes:input.sizeBytes})).resolves.toBe('not-found');
  });

  it('never issues an unfenced delete and treats a revealed older version as retryable',async()=>{
    const {client,store}=create(),input=value();await store.putImmutable(input);
    client.objects.get(input.key)!.versionId=undefined;
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:input.cipherDigest,expectedSizeBytes:input.sizeBytes})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(client.deleteCalls).toEqual([]);
    client.objects.get(input.key)!.versionId='version-1';
    client.replacementAfterDelete={bytes:Buffer.from('older'),cipherDigest:sha256(Buffer.from('older')),sizeBytes:5,versionId:'older-version'};
    await expect(store.deleteIfMatch({...input,expectedCipherDigest:input.cipherDigest,expectedSizeBytes:input.sizeBytes})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(client.deleteCalls).toEqual([{key:input.key,versionId:'version-1'}]);
    expect(client.objects.get(input.key)?.versionId).toBe('older-version');
  });
});

describe('Hosted Board bucket policy', () => {
  it.each([
    { access: 'public', versioning: 'enabled', objectLock: 'enabled' },
    { access: 'private', versioning: 'disabled', objectLock: 'enabled' },
    { access: 'private', versioning: 'enabled', objectLock: 'disabled' },
  ] as HostedBoardBucketPolicy[])('rejects incompatible policy %#', async policy => {
    const client = new MemoryHostedClient(); client.policy = policy;
    const store = new HostedBoardBlobStore(client, { requireObjectLock: true });
    await expect(store.assertReady()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('permits an explicitly optional object-lock policy while still requiring private versioned storage', async () => {
    const client = new MemoryHostedClient(); client.policy.objectLock = 'disabled';
    await expect(new HostedBoardBlobStore(client, { requireObjectLock: false }).assertReady()).resolves.toBeUndefined();
  });

  it('exposes only digest-fenced deletion',()=>{const client=new MemoryHostedClient(),store=new HostedBoardBlobStore(client,{requireObjectLock:false});expect('deleteIfMatch' in store).toBe(true);expect('delete' in store).toBe(false);});
});
