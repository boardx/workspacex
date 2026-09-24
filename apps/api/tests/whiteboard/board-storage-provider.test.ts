import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BOARD_BLOB_CODEC, BOARD_BLOB_STORE } from '../../src/application/whiteboard/blob-ports';
import { BOARD_HOSTED_CLIENT_FACTORY, BOARD_VERSIONED_KEY_SOURCE, boardBlobRoot, boardStorageProviders, ConfiguredFsBoardBlobStore } from '../../src/infrastructure/whiteboard/board-storage.providers';
import { boardBlobProviderKind } from '../../src/infrastructure/whiteboard/board-blob-runtime';

describe('board storage providers', () => {
  it('registers one validated selection feeding both storage and encryption boundaries', () => {
    const tokens = boardStorageProviders.map(provider => 'provide' in provider ? provider.provide : null);
    expect(tokens).toHaveLength(5);
    expect(tokens).toEqual(expect.arrayContaining([BOARD_BLOB_STORE, BOARD_BLOB_CODEC, BOARD_HOSTED_CLIENT_FACTORY, BOARD_VERSIONED_KEY_SOURCE]));
  });

  it('refuses a temporary filesystem root in production', () => {
    expect(() => boardBlobRoot({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_ROOT: `${tmpdir()}/board-content` })).toThrow(/durable storage/);
    expect(boardBlobRoot({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_ROOT: '/srv/workspacex/board-content' })).toBe('/srv/workspacex/board-content');
  });

  it('requires an explicit absolute production root without echoing its value', () => {
    expect(() => boardBlobRoot({ NODE_ENV: 'production' })).toThrow('WORKSPACEX_BOARD_BLOB_ROOT');
    const configured = 'relative/private-board-path';
    try { boardBlobRoot({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_ROOT: configured }); }
    catch (error) {
      expect((error as Error).message).toContain('WORKSPACEX_BOARD_BLOB_ROOT');
      expect((error as Error).message).not.toContain(configured);
      return;
    }
    throw new Error('relative production Board root was accepted');
  });

  it('fails closed for ambiguous or multi-replica production storage topology', () => {
    expect(() => boardBlobProviderKind({ NODE_ENV: 'production' })).toThrow('WORKSPACEX_BOARD_BLOB_PROVIDER');
    expect(() => boardBlobProviderKind({ WORKSPACEX_BOARD_BLOB_PROVIDER: 'unknown' })).toThrow('filesystem or hosted');
    expect(() => new ConfiguredFsBoardBlobStore({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'filesystem', WORKSPACEX_BOARD_BLOB_ROOT: '/srv/workspacex/board-content' })).toThrow('WORKSPACEX_BOARD_SINGLE_REPLICA=true');
    expect(() => new ConfiguredFsBoardBlobStore({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'filesystem', WORKSPACEX_BOARD_SINGLE_REPLICA: 'true' })).toThrow('WORKSPACEX_BOARD_BLOB_ROOT');
    expect(() => new ConfiguredFsBoardBlobStore({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'filesystem', WORKSPACEX_BOARD_SINGLE_REPLICA: 'true', WORKSPACEX_BOARD_BLOB_ROOT: `${tmpdir()}/board-content` })).toThrow('durable storage');
    expect(() => new ConfiguredFsBoardBlobStore({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'hosted' })).toThrow('not registered');
    expect(() => new ConfiguredFsBoardBlobStore({ NODE_ENV: 'production', WORKSPACEX_BOARD_BLOB_PROVIDER: 'filesystem', WORKSPACEX_BOARD_SINGLE_REPLICA: 'true', WORKSPACEX_BOARD_BLOB_ROOT: '/srv/workspacex/board-content' })).not.toThrow();
  });
});
