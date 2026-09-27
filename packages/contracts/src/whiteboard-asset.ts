import { z } from 'zod';
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
