import { z } from 'zod';
import { BoardId } from './whiteboard';
export const WHITEBOARD_ASSET_LIMITS = { bytes: 25 * 1024 * 1024, dimension: 32768, pixels: 16 * 1024 * 1024, frames: 100, concurrentDecodes: 2 } as const;
export const WhiteboardImageMime = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
export const WhiteboardAssetId = z.string().regex(/^board-image-[a-f0-9]{64}$/);
export const WhiteboardAssetMetadata = z.object({
  assetId: WhiteboardAssetId, mimeType: WhiteboardImageMime, magicMimeType: WhiteboardImageMime,
  byteSize: z.number().int().positive().max(WHITEBOARD_ASSET_LIMITS.bytes), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  intrinsicWidth: z.number().int().positive().max(WHITEBOARD_ASSET_LIMITS.dimension),
  intrinsicHeight: z.number().int().positive().max(WHITEBOARD_ASSET_LIMITS.dimension),
  persistence: z.literal('durable'),
}).strict();
export type WhiteboardAssetMetadata = z.infer<typeof WhiteboardAssetMetadata>;

export const WHITEBOARD_DOWNLOAD_GRANT_TTL_SECONDS = 120;
export const WhiteboardAssetDownloadGrant = z.object({
  downloadPath: z.string().startsWith('/whiteboards/'),
  expiresAt: z.string().datetime(),
  oneTime: z.literal(false),
}).strict();
export const WhiteboardAssetDownloadToken = z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).max(4096);

export const operations = {
  issueDownloadGrant: {
    method: 'POST', path: '/whiteboards/:boardId/assets/:assetId/download-grant',
    in: z.object({ boardId: BoardId, assetId: WhiteboardAssetId }).strict(), out: WhiteboardAssetDownloadGrant,
    err: ['NOT_FOUND', 'FORBIDDEN', 'INTEGRITY_FAILED', 'DEPENDENCY_UNAVAILABLE'] as const,
  },
  downloadWithGrant: {
    method: 'GET', path: '/whiteboards/:boardId/assets/downloads/:token',
    in: z.object({ boardId: BoardId, token: WhiteboardAssetDownloadToken }).strict(), out: WhiteboardAssetMetadata,
    err: ['NOT_FOUND', 'FORBIDDEN', 'INTEGRITY_FAILED', 'DEPENDENCY_UNAVAILABLE'] as const,
  },
} as const;
