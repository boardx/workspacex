import type { BoardBlobCodec, BoardBlobStore } from '../../application/whiteboard/blob-ports';
import { BoardBlobError } from '../../application/whiteboard/blob-ports';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver, KmsBoardTenantKeyResolver, type VersionedBoardMasterKeySource } from './aes-gcm-board-blob-codec';
import { assertFilesystemBoardBlobRuntime, boardBlobProviderKind } from './board-blob-runtime';
import { boardBlobRoot } from './board-storage.providers';
import { FsBoardBlobStore } from './fs-board-blob-store';
import { FileBoardMasterKeySource } from './file-board-master-key-source';
import { OssBoardBlobStore, S3CompatibleBoardBlobStore, type HostedBoardBlobClient } from './hosted-board-blob-store';

export type BoardBlobProviderKind = 'filesystem' | 'aliyun-oss' | 's3-compatible';
export type BoardKeyProviderKind = 'development-env' | 'versioned-kms';

export interface BoardStorageSelectionConfig {
  blobProvider: BoardBlobProviderKind;
  keyProvider: BoardKeyProviderKind;
  requireObjectLock: boolean;
  bucket?: string;
  prefix?: string;
}

export interface HostedBoardClientFactory {
  create(input: { provider: Exclude<BoardBlobProviderKind, 'filesystem'>; bucket: string; prefix: string }): Promise<HostedBoardBlobClient>;
}

export interface BoardStorageSelectionDependencies {
  hostedClients?: HostedBoardClientFactory;
  versionedKeys?: VersionedBoardMasterKeySource;
}

export interface BoardStorageSelection {
  store: BoardBlobStore;
  codec: BoardBlobCodec;
  config: BoardStorageSelectionConfig;
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value || /[\r\n\u0000]/.test(value)) throw new BoardBlobError('INVALID_INPUT', `${name} is required`);
  return value;
};

export function readBoardStorageSelection(env: NodeJS.ProcessEnv = process.env): BoardStorageSelectionConfig {
  const production = env.NODE_ENV === 'production';
  const topology = boardBlobProviderKind(env);
  const hostedValue = env.WORKSPACEX_BOARD_HOSTED_PROVIDER?.trim();
  const blobProvider: BoardBlobProviderKind = topology === 'filesystem' ? 'filesystem'
    : hostedValue === 'aliyun-oss' || hostedValue === 's3-compatible' ? hostedValue
    : (() => { throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_HOSTED_PROVIDER is missing or unsupported'); })();

  const keyValue = env.WORKSPACEX_BOARD_KEY_PROVIDER?.trim();
  const keyProvider = keyValue === undefined || keyValue === ''
    ? production ? undefined : 'development-env'
    : keyValue;
  if (keyProvider !== 'development-env' && keyProvider !== 'versioned-kms') {
    throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'WORKSPACEX_BOARD_KEY_PROVIDER is missing or unsupported');
  }
  if (production && keyProvider === 'development-env') {
    throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'development board keys cannot be used in production');
  }

  const lock = env.WORKSPACEX_BOARD_BLOB_OBJECT_LOCK?.trim() || 'disabled';
  if (lock !== 'required' && lock !== 'disabled') throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_BLOB_OBJECT_LOCK is invalid');

  if (blobProvider === 'filesystem') {
    // Evaluate durable-root constraints during startup, before accepting collaboration traffic.
    assertFilesystemBoardBlobRuntime(env);
    boardBlobRoot(env);
    return { blobProvider, keyProvider, requireObjectLock: false };
  }
  const bucket = required(env, 'WORKSPACEX_BOARD_BLOB_BUCKET');
  const prefix = required(env, 'WORKSPACEX_BOARD_BLOB_PREFIX');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/.test(prefix) || prefix.includes('..') || prefix.startsWith('/')) {
    throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_BLOB_PREFIX is invalid');
  }
  return { blobProvider, keyProvider, requireObjectLock: lock === 'required', bucket, prefix: prefix.replace(/\/$/, '') };
}

/** Builds and validates the complete Board persistence boundary before startup may succeed. */
export async function createBoardStorageSelection(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: BoardStorageSelectionDependencies = {},
): Promise<BoardStorageSelection> {
  const config = readBoardStorageSelection(env);
  const keys = config.keyProvider === 'development-env'
    ? new EnvBoardTenantKeyResolver(env)
    : dependencies.versionedKeys
      ? new KmsBoardTenantKeyResolver(dependencies.versionedKeys)
      : env.WORKSPACEX_BOARD_KEY_DIRECTORY
        ? new KmsBoardTenantKeyResolver(new FileBoardMasterKeySource(env.WORKSPACEX_BOARD_KEY_DIRECTORY))
        : undefined;
  if (!keys) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'versioned board key service is not configured');

  if (config.blobProvider === 'filesystem') {
    return { config, store: new FsBoardBlobStore(boardBlobRoot(env)), codec: new AesGcmBoardBlobCodec(keys) };
  }
  if (!dependencies.hostedClients || !config.bucket || !config.prefix) {
    throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage client is not configured');
  }
  let client: HostedBoardBlobClient;
  try { client = await dependencies.hostedClients.create({ provider: config.blobProvider, bucket: config.bucket, prefix: config.prefix }); }
  catch { throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage client is not configured'); }
  const requirement = { requireObjectLock: config.requireObjectLock };
  const store = config.blobProvider === 'aliyun-oss'
    ? new OssBoardBlobStore(client, requirement)
    : new S3CompatibleBoardBlobStore(client, requirement);
  await store.assertReady();
  return { config, store, codec: new AesGcmBoardBlobCodec(keys) };
}
