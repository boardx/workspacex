import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { Provider } from '@nestjs/common';
import { BOARD_BLOB_CODEC, BOARD_BLOB_STORE, type BoardBlobCodec, type BoardBlobDescriptor, type BoardBlobIdentity, type BoardBlobStore } from '../../application/whiteboard/blob-ports';
import { objectStoreRoot } from '../storage/object-store-root';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver } from './aes-gcm-board-blob-codec';
import { assertFilesystemBoardBlobRuntime } from './board-blob-runtime';
import { FsBoardBlobStore } from './fs-board-blob-store';

export function boardBlobRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WORKSPACEX_BOARD_BLOB_ROOT;
  if (env.NODE_ENV === 'production' && (!configured || !isAbsolute(configured))) {
    throw new Error('WORKSPACEX_BOARD_BLOB_ROOT must be an explicit absolute durable path in production');
  }
  const root = resolve(configured || (env.WORKSPACEX_OBJECT_ROOT ? join(env.WORKSPACEX_OBJECT_ROOT, 'board-content') : join(objectStoreRoot(), 'board-content')));
  const temporary = resolve(tmpdir());
  if (env.NODE_ENV === 'production' && (root === temporary || root.startsWith(temporary + sep))) {
    throw new Error('WORKSPACEX_BOARD_BLOB_ROOT must point to durable storage in production');
  }
  return root;
}

/** Local implementation selected only after the runtime topology gate succeeds. */
export class ConfiguredFsBoardBlobStore implements BoardBlobStore {
  private store?: FsBoardBlobStore;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    assertFilesystemBoardBlobRuntime(env);
    boardBlobRoot(env);
  }
  putImmutable(input: BoardBlobIdentity & BoardBlobDescriptor & { ciphertext: Uint8Array }): Promise<'created' | 'already-present-same-content'> {
    return this.configured().putImmutable(input);
  }
  getVerified(input: BoardBlobIdentity & { expectedCipherDigest: string; expectedSizeBytes: number }): Promise<Uint8Array> {
    return this.configured().getVerified(input);
  }
  head(input: BoardBlobIdentity): Promise<BoardBlobDescriptor | null> { return this.configured().head(input); }
  private configured(): FsBoardBlobStore { return this.store ??= new FsBoardBlobStore(boardBlobRoot(this.env)); }
}

export interface ConfiguredBoardStorageRuntime { blobs: BoardBlobStore; codec: BoardBlobCodec }

/**
 * Composition seam used by HTTP, single-Board migration and fleet rollout.
 * Hosted/KMS changes replace this one factory rather than being bypassed by a CLI.
 */
export function createConfiguredBoardStorageRuntime(env: NodeJS.ProcessEnv = process.env): ConfiguredBoardStorageRuntime {
  return { blobs: new ConfiguredFsBoardBlobStore(env), codec: new AesGcmBoardBlobCodec(new EnvBoardTenantKeyResolver(env)) };
}

export const boardStorageProviders: Provider[] = [
  { provide: BOARD_BLOB_STORE, useFactory: () => createConfiguredBoardStorageRuntime().blobs },
  { provide: BOARD_BLOB_CODEC, useFactory: () => createConfiguredBoardStorageRuntime().codec },
];
