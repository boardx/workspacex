import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, expect, it, vi } from 'vitest';
import { OBJECT_STORE, type ObjectStore } from '../../src/application/artifact/ports';
import { PHYSICAL_PURGE_PORT, type PhysicalPurgePort } from '../../src/application/files/physical-delete-ports';
import { storageProviders } from '../../src/infrastructure/storage/storage.providers';

const sdk = vi.hoisted(() => ({ getBucketVersioning: vi.fn(async () => ({})), getBucketACL: vi.fn(async () => ({ acl: 'private' })),
  put: vi.fn(async () => {}), get: vi.fn(), head: vi.fn(async () => { throw { code: 'NoSuchKey', status: 404 }; }), delete: vi.fn(async () => {}) }));
vi.mock('../../src/infrastructure/storage/oss-sdk-client', () => ({ createOssSdkClient: vi.fn(async () => sdk) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('Nest boots both ports against the same selected OSS deployment', async () => {
  for (const [key, value] of Object.entries({ WORKSPACEX_DEPLOY_PROFILE: 'production', WORKSPACEX_OBJECT_STORE: 'oss',
    OSS_REGION: 'cn-hangzhou', OSS_BUCKET: 'test-bucket', OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
    OSS_PREFIX: 'deployments/wiring', OSS_ROLE_NAME: 'runtime' })) vi.stubEnv(key, value);
  class StorageTestModule {}
  Module({ providers: storageProviders })(StorageTestModule);
  const context = await NestFactory.createApplicationContext(StorageTestModule, { logger: false, abortOnError: false });
  try {
    const store = context.get<ObjectStore>(OBJECT_STORE);
    const purge = context.get<PhysicalPurgePort>(PHYSICAL_PURGE_PORT);
    await store.putOnce('org/key', Buffer.from('x'), 'text/plain');
    expect(sdk.put).toHaveBeenCalledWith('deployments/wiring/org/key', expect.any(Buffer), expect.any(Object));
    expect(await purge.purgeAll(['org/key'])).toEqual([{ objectKey: 'org/key', deleted: true }]);
    expect(sdk.delete).toHaveBeenCalledWith('deployments/wiring/org/key');
    expect('delete' in store).toBe(false);
  } finally { await context.close(); }
});
