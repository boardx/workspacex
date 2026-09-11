import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { objectStoreConfig } from '../../src/infrastructure/storage/object-store-config';
import { createStorageBackends } from '../../src/infrastructure/storage/create-object-store';
import { ossCredentialSource } from '../../src/infrastructure/storage/oss-sdk-client';

const config = { OSS_REGION: 'cn-hangzhou', OSS_BUCKET: 'test-bucket',
  OSS_ENDPOINT: 'https://oss-cn-hangzhou-internal.aliyuncs.com', OSS_PREFIX: 'deployments/a', OSS_ROLE_NAME: 'workspacex-runtime' };

describe('OSS runtime configuration', () => {
  it.each(['starter', 'production'])('requires OSS for %s', (profile) => {
    expect(objectStoreConfig({ ...config, WORKSPACEX_DEPLOY_PROFILE: profile }).backend).toBe('oss');
    expect(() => objectStoreConfig({ ...config, WORKSPACEX_DEPLOY_PROFILE: profile, WORKSPACEX_OBJECT_STORE: 'fs' })).toThrow('Cloud deployments require OSS');
  });
  it('preserves an explicit local development FS store and paired purge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wsx-oss-fs-'));
    try {
      const { objects, purge } = await createStorageBackends({ WORKSPACEX_OBJECT_ROOT: root });
      await objects.putOnce('org/key', Buffer.from('local'), 'text/plain');
      expect(await objects.get('org/key')).toEqual(new Uint8Array(Buffer.from('local')));
      expect(await purge.purgeAll(['org/key'])).toEqual([{ objectKey: 'org/key', deleted: true }]);
      expect(await objects.get('org/key')).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('does not silently ignore partial cloud configuration', () => {
    expect(() => objectStoreConfig({ OSS_BUCKET: 'test-bucket' })).toThrow();
    expect(() => objectStoreConfig({ WORKSPACEX_OBJECT_STORE: 'osss' })).toThrow();
    expect(() => objectStoreConfig({ WORKSPACEX_DEPLOY_PROFILE: 'prod' })).toThrow();
  });
  it('reports all missing OSS configuration names without input values', () => {
    expect(() => objectStoreConfig({ WORKSPACEX_OBJECT_STORE: 'oss' })).toThrow('region, bucket, endpoint, prefix');
    expect(() => objectStoreConfig({ ...config, WORKSPACEX_OBJECT_STORE: 'oss', OSS_ENDPOINT: 'https://SECRET@example.com' })).toThrow('Invalid OSS configuration: endpoint');
  });
  it.each([
    { OSS_REGION: 'cn-beijing' }, { OSS_ENDPOINT: 'http://oss-cn-hangzhou.aliyuncs.com' },
    { OSS_PREFIX: '../b' }, { OSS_ROLE_NAME: '' }, { OSS_AUTH_MODE: 'guess' },
  ])('rejects unsafe or ambiguous options %j', (patch) => {
    expect(() => objectStoreConfig({ ...config, ...patch, WORKSPACEX_OBJECT_STORE: 'oss' })).toThrow();
  });
  it('requires complete explicit environment credentials and reads rotations', async () => {
    const parsed = objectStoreConfig({ ...config, WORKSPACEX_OBJECT_STORE: 'oss', OSS_AUTH_MODE: 'environment' });
    if (parsed.backend !== 'oss') throw new Error('invalid fixture');
    const env: NodeJS.ProcessEnv = {};
    const source = ossCredentialSource(parsed.oss, env);
    await expect(source()).rejects.toThrow('OSS credentials unavailable');
    env.OSS_ACCESS_KEY_ID = 'id'; env.OSS_ACCESS_KEY_SECRET = 'first'; env.OSS_SECURITY_TOKEN = 'token';
    expect(await source()).toEqual({ accessKeyId: 'id', accessKeySecret: 'first', stsToken: 'token' });
    env.OSS_ACCESS_KEY_SECRET = 'second'; expect((await source()).accessKeySecret).toBe('second');
  });
  it('does not fall back to filesystem when the OSS client cannot initialize', async () => {
    await expect(createStorageBackends({ ...config, WORKSPACEX_OBJECT_STORE: 'oss', OSS_AUTH_MODE: 'environment' }))
      .rejects.toThrow('OSS credentials unavailable');
  });
});
