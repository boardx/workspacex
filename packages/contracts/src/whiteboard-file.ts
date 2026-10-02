import { z } from 'zod';
import { BoardId } from './whiteboard';

export const WHITEBOARD_FILE_LIMITS = { bytes: 25 * 1024 * 1024 } as const;
export const WhiteboardFileAssetId = z.string().regex(/^board-file-[a-f0-9]{64}$/);
export const WhiteboardFileMetadata = z.object({
  assetId: WhiteboardFileAssetId,
  fileName: z.string().min(1).max(255).refine(value => !/[/\\\x00-\x1f]/.test(value)),
  mimeType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/).max(255),
  byteSize: z.number().int().positive().max(WHITEBOARD_FILE_LIMITS.bytes),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  persistence: z.literal('durable'),
}).strict();
export type WhiteboardFileMetadata = z.infer<typeof WhiteboardFileMetadata>;
export const operations = {
  // Bytes use the multipart `file` part; the optional raw field preserves browser filenames.
  upload: { method: 'POST', path: '/whiteboards/:boardId/files', in: z.object({ boardId: BoardId, fileName: WhiteboardFileMetadata.shape.fileName.optional() }).strict(), out: WhiteboardFileMetadata },
  content: { method: 'GET', path: '/whiteboards/:boardId/files/:assetId/content', in: z.object({ boardId: BoardId, assetId: WhiteboardFileAssetId }).strict(), out: WhiteboardFileMetadata },
} as const;
