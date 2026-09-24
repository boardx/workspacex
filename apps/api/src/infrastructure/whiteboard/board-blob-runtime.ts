import { BoardBlobError } from '../../application/whiteboard/blob-ports';

export type BoardBlobProviderKind = 'filesystem' | 'hosted';

/** Selects the persistence topology before collaboration can publish content. */
export function boardBlobProviderKind(env: NodeJS.ProcessEnv = process.env): BoardBlobProviderKind {
  const configured = env.WORKSPACEX_BOARD_BLOB_PROVIDER;
  if (configured !== undefined && configured !== 'filesystem' && configured !== 'hosted') {
    throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_BLOB_PROVIDER must be filesystem or hosted');
  }
  if (env.NODE_ENV === 'production' && configured === undefined) {
    throw new BoardBlobError('STORAGE_UNAVAILABLE', 'WORKSPACEX_BOARD_BLOB_PROVIDER is required in production');
  }
  return configured ?? 'filesystem';
}

/**
 * The `hosted` branch is the adapter seam owned by #4063.  Until that adapter
 * is registered, selecting it fails closed instead of using node-local disk.
 */
export function assertFilesystemBoardBlobRuntime(env: NodeJS.ProcessEnv = process.env): void {
  const provider = boardBlobProviderKind(env);
  if (provider === 'hosted') {
    throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted Board blob provider is not registered');
  }
  if (env.NODE_ENV === 'production' && env.WORKSPACEX_BOARD_SINGLE_REPLICA !== 'true') {
    throw new BoardBlobError('STORAGE_UNAVAILABLE', 'filesystem Board blob storage requires WORKSPACEX_BOARD_SINGLE_REPLICA=true in production');
  }
}
