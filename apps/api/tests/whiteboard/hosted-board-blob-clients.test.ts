import { describe, expect, it, vi } from 'vitest';
import { AliyunOssBoardBlobClient, S3CompatibleBoardBlobClient, type AliyunOssBoardProtocol, type S3CompatibleBoardProtocol } from '../../src/infrastructure/whiteboard/hosted-board-blob-clients';

describe('AliyunOssBoardBlobClient', () => {
  it('uses forbid-overwrite, immutable metadata, prefixing, and policy inspection', async () => {
    const put = vi.fn(async () => undefined);
    const protocol: AliyunOssBoardProtocol = {
      async getBucketVersioning() { return { versionStatus: 'Enabled' }; },
      async getBucketACL() { return { acl: 'private' }; },
      async getBucketPolicy() { return { policy: null }; },
      async getBucketObjectLock() { return { status: 'Enabled' }; },
      put,
      async get() { return { content: Buffer.from('abc'), headers: { 'x-oss-meta-cipher-digest': 'd'.repeat(64), 'x-oss-meta-size-bytes': '3' } }; },
      async head() { return { headers: { 'x-oss-meta-cipher-digest': 'd'.repeat(64), 'x-oss-meta-size-bytes': '3', 'content-length': '3' } }; },
      async delete() {},
    };
    const client = new AliyunOssBoardBlobClient(protocol, 'board-private', 'board-content');
    expect(await client.inspectBucket()).toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    await client.putIfAbsent({ key: 'tenants/t/update/sha256/d', bytes: Buffer.from('abc'), contentType: 'application/octet-stream', metadata: { cipherDigest: 'd'.repeat(64), sizeBytes: 3 } });
    expect(put).toHaveBeenCalledWith('board-content/tenants/t/update/sha256/d', Buffer.from('abc'), expect.objectContaining({
      headers: expect.objectContaining({ 'x-oss-forbid-overwrite': 'true', 'x-oss-meta-cipher-digest': 'd'.repeat(64), 'x-oss-meta-size-bytes': '3' }),
    }));
  });

  it('normalizes conflicts and missing objects and forwards version-fenced deletion', async () => {
    const remove=vi.fn(async()=>undefined);
    const protocol = {
      async getBucketVersioning() { return { versionStatus: 'Enabled' }; }, async getBucketACL() { return { acl: 'private' }; }, async getBucketPolicy() { return { policy: null }; },
      async getBucketObjectLock() { return { status: 'Enabled' }; }, async put() { throw Object.assign(new Error('secret'), { code: 'FileAlreadyExists' }); },
      async get() { throw Object.assign(new Error('secret'), { code: 'NoSuchKey' }); }, async head() { throw Object.assign(new Error('secret'), { code: 'NoSuchKey' }); },delete:remove,
    } satisfies AliyunOssBoardProtocol;
    const client = new AliyunOssBoardBlobClient(protocol, 'bucket', 'prefix');
    await expect(client.putIfAbsent({ key: 'key', bytes: Buffer.from('a'), contentType: 'application/octet-stream', metadata: { cipherDigest: 'a'.repeat(64), sizeBytes: 1 } })).resolves.toBe('already-exists');
    await expect(client.get('key')).resolves.toBeNull(); await expect(client.head('key')).resolves.toBeNull();
    await expect(client.deleteCurrent('key','v1')).resolves.toBe('deleted');expect(remove).toHaveBeenCalledWith('prefix/key',{versionId:'v1'});
  });
});

describe('S3CompatibleBoardBlobClient', () => {
  it('uses If-None-Match for S3/R2/MinIO and carries verified metadata', async () => {
    const putObject = vi.fn(async () => undefined);
    const protocol: S3CompatibleBoardProtocol = {
      async getBucketVersioning() { return { status: 'Enabled' }; }, async getBucketAccess() { return { private: true }; },
      async getObjectLockConfiguration() { return { enabled: true }; }, putObject,
      async getObject() { return { body: Buffer.from('abc'), metadata: { 'cipher-digest': 'd'.repeat(64), 'size-bytes': '3' }, contentLength: 3 }; },
      async headObject() { return { metadata: { 'cipher-digest': 'd'.repeat(64), 'size-bytes': '3' }, contentLength: 3 }; },
      async deleteObject() {},
    };
    const client = new S3CompatibleBoardBlobClient(protocol, 'bucket', 'board-content');
    expect(await client.inspectBucket()).toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    await client.putIfAbsent({ key: 'tenants/t/update/sha256/d', bytes: Buffer.from('abc'), contentType: 'application/octet-stream', metadata: { cipherDigest: 'd'.repeat(64), sizeBytes: 3 } });
    expect(putObject).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'bucket', key: 'board-content/tenants/t/update/sha256/d', ifNoneMatch: '*', metadata: { 'cipher-digest': 'd'.repeat(64), 'size-bytes': '3' } }));
  });

  it('normalizes conditional conflicts', async () => {
    const protocol = {
      async getBucketVersioning() { return { status: 'Enabled' }; }, async getBucketAccess() { return { private: true }; },
      async getObjectLockConfiguration() { return { enabled: false }; }, async putObject() { throw Object.assign(new Error('secret'), { name: 'PreconditionFailed' }); },
      async getObject() { return null; }, async headObject() { return null; },
      async deleteObject() {},
    } satisfies S3CompatibleBoardProtocol;
    const client = new S3CompatibleBoardBlobClient(protocol, 'bucket', 'prefix');
    await expect(client.putIfAbsent({ key: 'key', bytes: Buffer.from('a'), contentType: 'application/octet-stream', metadata: { cipherDigest: 'a'.repeat(64), sizeBytes: 1 } })).resolves.toBe('already-exists');
  });

  it.each(['../escape', 'tenant/../escape', '/absolute', 'tenant//key'])('rejects unsafe object keys before calling the provider: %s', async key => {
    const putObject = vi.fn(async () => undefined);
    const protocol = {
      async getBucketVersioning() { return { status: 'Enabled' }; }, async getBucketAccess() { return { private: true }; },
      async getObjectLockConfiguration() { return { enabled: false }; }, putObject,
      async getObject() { return null; }, async headObject() { return null; }, async deleteObject() {},
    } satisfies S3CompatibleBoardProtocol;
    const client = new S3CompatibleBoardBlobClient(protocol, 'bucket', 'prefix');
    await expect(client.putIfAbsent({ key, bytes: Buffer.from('a'), contentType: 'application/octet-stream', metadata: { cipherDigest: 'a'.repeat(64), sizeBytes: 1 } })).rejects.toThrow('S3-compatible Board request failed');
    expect(putObject).not.toHaveBeenCalled();
  });
});
