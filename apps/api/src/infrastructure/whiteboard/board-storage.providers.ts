import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Provider } from '@nestjs/common';
import { BOARD_BLOB_CODEC, BOARD_BLOB_STORE } from '../../application/whiteboard/blob-ports';
import { objectStoreRoot } from '../storage/object-store-root';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver } from './aes-gcm-board-blob-codec';
import { FsBoardBlobStore } from './fs-board-blob-store';

export function boardBlobRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = resolve(env.WORKSPACEX_BOARD_BLOB_ROOT || (env.WORKSPACEX_OBJECT_ROOT ? join(env.WORKSPACEX_OBJECT_ROOT, 'board-content') : join(objectStoreRoot(), 'board-content')));
  const temporary = resolve(tmpdir());
  if (env.NODE_ENV === 'production' && (root === temporary || root.startsWith(temporary + sep))) {
    throw new Error('WORKSPACEX_BOARD_BLOB_ROOT must point to durable storage in production');
  }
  return root;
}

export const boardStorageProviders: Provider[] = [
  { provide: BOARD_BLOB_STORE, useFactory: () => new FsBoardBlobStore(boardBlobRoot()) },
  { provide: BOARD_BLOB_CODEC, useFactory: () => new AesGcmBoardBlobCodec(new EnvBoardTenantKeyResolver()) },
];
