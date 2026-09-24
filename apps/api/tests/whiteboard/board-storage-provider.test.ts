import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BOARD_BLOB_CODEC, BOARD_BLOB_STORE } from '../../src/application/whiteboard/blob-ports';
import { boardBlobRoot, boardStorageProviders } from '../../src/infrastructure/whiteboard/board-storage.providers';

describe('board storage providers', () => {
  it('registers the store and encryption boundary without switching collaboration persistence', () => {
    expect(boardStorageProviders.map(provider => 'provide' in provider ? provider.provide : null)).toEqual([BOARD_BLOB_STORE, BOARD_BLOB_CODEC]);
  });

  it('refuses a temporary filesystem root in production', () => {
    expect(() => boardBlobRoot({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_ROOT: `${tmpdir()}/board-content` })).toThrow(/durable storage/);
    expect(boardBlobRoot({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_ROOT: '/srv/workspacex/board-content' })).toBe('/srv/workspacex/board-content');
  });
});
