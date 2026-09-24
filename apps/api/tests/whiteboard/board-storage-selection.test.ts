import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBoardStorageSelection, readBoardStorageSelection } from '../../src/infrastructure/whiteboard/board-storage-selection';
import type { HostedBoardBlobClient, HostedBoardBucketPolicy } from '../../src/infrastructure/whiteboard/hosted-board-blob-store';

const hostedClient = (provider: HostedBoardBlobClient['provider'], policy: HostedBoardBucketPolicy = { access: 'private', versioning: 'enabled', objectLock: 'enabled' }): HostedBoardBlobClient => ({
  provider,
  async inspectBucket() { return policy; },
  async putIfAbsent() { return 'created'; }, async get() { return null; }, async head() { return null; },
});

describe('Board storage provider selection', () => {
  it('defaults to filesystem plus env keys only outside production', () => {
    expect(readBoardStorageSelection({ NODE_ENV: 'test' })).toEqual({ blobProvider: 'filesystem', keyProvider: 'development-env', requireObjectLock: false });
  });

  it('fails production startup when either provider selection is implicit or env keys are requested', () => {
    expect(() => readBoardStorageSelection({ NODE_ENV: 'production', WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms' })).toThrow(/BLOB_PROVIDER/);
    expect(() => readBoardStorageSelection({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'filesystem', WORKSPACEX_BOARD_BLOB_ROOT: '/srv/board', WORKSPACEX_BOARD_KEY_PROVIDER: 'development-env' })).toThrow(/development board keys/);
  });

  it('requires complete Hosted bucket and prefix configuration without echoing values', () => {
    expect(() => readBoardStorageSelection({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted', WORKSPACEX_BOARD_HOSTED_PROVIDER: 'aliyun-oss', WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms' })).toThrow(/BLOB_BUCKET/);
    const secretPath = 'private/../escape';
    try {
      readBoardStorageSelection({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted', WORKSPACEX_BOARD_HOSTED_PROVIDER: 's3-compatible', WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms', WORKSPACEX_BOARD_BLOB_BUCKET: 'bucket', WORKSPACEX_BOARD_BLOB_PREFIX: secretPath });
    } catch (error) {
      expect((error as Error).message).not.toContain(secretPath); return;
    }
    throw new Error('invalid prefix accepted');
  });

  it.each([
    ['aliyun-oss', 'aliyun-oss'],
    ['s3-compatible', 's3-compatible'],
  ] as const)('builds and startup-validates %s with versioned KMS', async (blobProvider, protocolProvider) => {
    let inspected = 0;
    const client = hostedClient(protocolProvider);
    client.inspectBucket = async () => { inspected += 1; return { access: 'private', versioning: 'enabled', objectLock: 'enabled' }; };
    const selected = await createBoardStorageSelection({
      NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted', WORKSPACEX_BOARD_HOSTED_PROVIDER: blobProvider, WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms',
      WORKSPACEX_BOARD_BLOB_BUCKET: 'private-board', WORKSPACEX_BOARD_BLOB_PREFIX: 'board-content', WORKSPACEX_BOARD_BLOB_OBJECT_LOCK: 'required',
    }, {
      hostedClients: { create: async () => client },
      versionedKeys: { async resolveVersion(input) { return { version: input.version, keyMaterial: new Uint8Array(32).fill(1) }; } },
    });
    expect(selected.config.blobProvider).toBe(blobProvider); expect(inspected).toBe(1);
  });

  it('fails startup for absent provider clients, absent KMS, or incompatible policy', async () => {
    const env = { NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted', WORKSPACEX_BOARD_HOSTED_PROVIDER: 's3-compatible', WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms', WORKSPACEX_BOARD_BLOB_BUCKET: 'private-board', WORKSPACEX_BOARD_BLOB_PREFIX: 'board-content' };
    await expect(createBoardStorageSelection(env, {})).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    const keys = { async resolveVersion(input: { version: number }) { return { version: input.version, keyMaterial: new Uint8Array(32) }; } };
    await expect(createBoardStorageSelection(env, { versionedKeys: keys })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await expect(createBoardStorageSelection(env, { versionedKeys: keys, hostedClients: { create: async () => hostedClient('s3-compatible', { access: 'public', versioning: 'enabled', objectLock: 'disabled' }) } }))
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('accepts a deployment-managed versioned secret file when no KMS source is injected', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'wsx-board-selection-')), directory = join(parent, 'keys');
    await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
    await writeFile(join(directory, 'v1.key'), Buffer.alloc(32, 1).toString('base64'), { mode: 0o600 });
    const selected = await createBoardStorageSelection({
      NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted', WORKSPACEX_BOARD_HOSTED_PROVIDER: 's3-compatible',
      WORKSPACEX_BOARD_KEY_PROVIDER: 'versioned-kms', WORKSPACEX_BOARD_KEY_DIRECTORY: directory,
      WORKSPACEX_BOARD_BLOB_BUCKET: 'private-board', WORKSPACEX_BOARD_BLOB_PREFIX: 'board-content',
    }, { hostedClients: { create: async () => hostedClient('s3-compatible') } });
    expect(selected.config.keyProvider).toBe('versioned-kms');
  });
});
