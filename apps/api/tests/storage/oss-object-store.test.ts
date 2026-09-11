import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ObjectExistsError, ObjectStoreUnavailableError } from '../../src/application/artifact/ports';
import { OssObjectStore, OssPhysicalPurge, type OssClientPort } from '../../src/infrastructure/storage/oss-object-store';

function fixture() {
  const objects = new Map<string, { bytes: Buffer; headers: Record<string, string> }>();
  let versionStatus: string | undefined;
  let acl = 'private';
  let error: unknown;
  const client: OssClientPort = {
    async getBucketVersioning() { if (error) throw error; return { versionStatus }; },
    async getBucketACL() { return { acl }; },
    async put(key, bytes, options) {
      if (error) throw error;
      expect(options.headers['x-oss-forbid-overwrite']).toBe('true');
      expect(options.headers['Content-MD5']).toBe(createHash('md5').update(bytes).digest('base64'));
      if (objects.has(key)) throw { status: 409, code: 'FileAlreadyExists' };
      objects.set(key, { bytes: Buffer.from(bytes), headers: {
        'content-length': String(bytes.length), 'content-type': options.mime,
        'x-oss-meta-sha256': options.headers['x-oss-meta-sha256']!,
      } });
    },
    async get(key) { if (error) throw error; const o = objects.get(key); if (!o) throw { status: 404, code: 'NoSuchKey' }; return { content: Buffer.from(o.bytes), headers: o.headers }; },
    async head(key) { if (error) throw error; const o = objects.get(key); if (!o) throw { status: 404, code: 'NoSuchKey' }; return { headers: o.headers }; },
    async delete(key) { if (error) throw error; objects.delete(key); },
  };
  const store = new OssObjectStore(client, 'test-bucket', 'deployments/a');
  const purge = new OssPhysicalPurge(client, 'test-bucket', 'deployments/a');
  return { client, store, purge, objects, setVersion: (v: string | undefined) => { versionStatus = v; },
    setAcl: (v: string) => { acl = v; }, setError: (v: unknown) => { error = v; } };
}

describe('OSS ObjectStore contract', () => {
  it('writes, heads and reads exact bytes including MIME and SHA-256', async () => {
    const f = fixture(); await f.store.assertReady();
    const bytes = Buffer.from('文件\u0000binary');
    await f.store.putOnce('org-a/file.txt', bytes, 'text/plain; charset=utf-8');
    expect(await f.store.get('org-a/file.txt')).toEqual(bytes);
    expect(await f.store.head('org-a/file.txt')).toEqual({ sizeBytes: bytes.length, mime: 'text/plain; charset=utf-8' });
    expect([...f.objects.keys()]).toEqual(['deployments/a/org-a/file.txt']);
  });
  it('permits exactly one concurrent write and preserves the winner', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.store.putOnce('key', Buffer.from('first'), 'text/plain'), f.store.putOnce('key', Buffer.from('second'), 'text/plain')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(r => r.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason instanceof ObjectExistsError).toBe(true);
    expect(await f.store.get('key')).toEqual(Buffer.from('first'));
  });
  it('returns null only for a missing object, not missing bucket or forbidden access', async () => {
    const f = fixture(); expect(await f.store.get('missing')).toBeNull(); expect(await f.store.head('missing')).toBeNull();
    for (const e of [{ status: 404, code: 'NoSuchBucket' }, { status: 403, code: 'AccessDenied' }]) {
      f.setError(e); await expect(f.store.get('missing')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
      await expect(f.store.head('missing')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    }
  });
  it.each(['Enabled', 'Suspended', 'unknown'])('rejects version state %s even after startup', async (state) => {
    const f = fixture(); await f.store.assertReady(); f.setVersion(state);
    await expect(f.store.putOnce('key', Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    expect(f.objects.size).toBe(0);
    expect(await f.purge.purgeAll(['key'])).toEqual([{ objectKey: 'key', deleted: false }]);
  });
  it('rejects public buckets', async () => {
    const f = fixture(); f.setAcl('public-read'); await expect(f.store.assertReady()).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
  });
  it.each(['../other', '/absolute', 'a/../other', 'a//b', 'a\\b', 'a\u0000b', ''])('rejects invalid key %j before any operation', async (key) => {
    const f = fixture(); await expect(f.store.putOnce(key, Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    await expect(f.store.get(key)).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    expect(await f.purge.purgeAll([key])).toEqual([{ objectKey: key, deleted: false }]);
    expect(f.objects.size).toBe(0);
  });
  it('rejects corrupted bytes and malformed head metadata', async () => {
    const f = fixture(); await f.store.putOnce('key', Buffer.from('x'), 'text/plain');
    const object = f.objects.get('deployments/a/key')!; object.bytes = Buffer.from('y');
    await expect(f.store.get('key')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    object.headers['content-length'] = 'NaN';
    await expect(f.store.head('key')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
  });
  it('purges only its own prefix, is idempotent and leaves no public delete method', async () => {
    const f = fixture(); const other = new OssObjectStore(f.client, 'test-bucket', 'deployments/b');
    await f.store.putOnce('key', Buffer.from('a'), 'text/plain'); await other.putOnce('key', Buffer.from('b'), 'text/plain');
    expect('delete' in f.store).toBe(false);
    expect(await f.purge.purgeAll(['key', 'missing'])).toEqual([{ objectKey: 'key', deleted: true }, { objectKey: 'missing', deleted: true }]);
    expect(await f.store.get('key')).toBeNull(); expect(await other.get('key')).toEqual(Buffer.from('b'));
  });
  it('never leaks upstream secrets through adapter errors', async () => {
    const f = fixture(); f.setError(new Error('SECRET credential URL'));
    await expect(f.store.putOnce('key', Buffer.from('x'), 'text/plain')).rejects.toThrow('OSS unavailable');
  });
});
