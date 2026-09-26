import type { z } from 'zod';
import type { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';

export const BOARD_CONTENT_COPY_PORT = Symbol('BoardContentCopyPort');

export interface BoardContentVersion { epoch: number; seq: number; }
export interface CapturedBoardContent { source: BoardContentVersion; snapshot: Uint8Array; }
export interface PreparedBoardContent {
  snapshot: Uint8Array;
  objectCount: number;
  connectorCount: number;
  assetCount: number;
}

/**
 * Owns the atomic capture/publish boundary. The callback only transforms
 * canonical content; metadata and controllers never read or copy storage bytes.
 * Iteration 08 can replace this PostgreSQL adapter with a blob-manifest adapter
 * without changing the DuplicateBoard use case.
 */
export interface BoardContentCopyPort {
  duplicate(
    principal: Principal,
    sourceBoardId: string,
    input: z.infer<typeof C.DuplicateBoard>,
    prepare: (captured: CapturedBoardContent) => PreparedBoardContent,
  ): Promise<z.infer<typeof C.DuplicateBoardResult>>;
}
