import { z } from 'zod';
import { BoardId } from './whiteboard';
import { WHITEBOARD_LIMITS, WhiteboardObjectId } from './whiteboard-document';

export const BOARD_FILE_EXPORT_LIMITS = {
  objects: WHITEBOARD_LIMITS.objects,
  pages: 100,
  pixels: 40_000_000,
  bytes: 64 * 1024 * 1024,
  durationMs: 30_000,
  retainedJobs: 20,
} as const;

export const BoardFileExportFormat = z.enum(['png', 'svg', 'pdf', 'sticky-csv']);
export type BoardFileExportFormat = z.infer<typeof BoardFileExportFormat>;

export const BoardFileExportInput = z.object({
  format: BoardFileExportFormat,
  background: z.union([z.literal('transparent'), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default('#ffffff'),
}).strict();
export type BoardFileExportInput = z.infer<typeof BoardFileExportInput>;

export const BoardFileExportLoss = z.object({
  code: z.enum([
    'FONT_FALLBACK', 'UNSUPPORTED_PROPERTY', 'UNSUPPORTED_OBJECT',
    'HIDDEN_CONTENT_OMITTED', 'PRIVATE_CONTENT_OMITTED', 'ROTATION_APPROXIMATED',
  ]),
  count: z.number().int().positive().max(WHITEBOARD_LIMITS.objects),
  sampleObjectIds: z.array(WhiteboardObjectId).max(5),
  message: z.string().min(1).max(300),
}).strict();
export type BoardFileExportLoss = z.infer<typeof BoardFileExportLoss>;

export const BoardFileExportStatusValue = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const BoardFileExportStatus = z.object({
  jobId: z.string().uuid(),
  boardId: BoardId,
  format: BoardFileExportFormat,
  status: BoardFileExportStatusValue,
  progress: z.number().int().min(0).max(100),
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(100),
  objectCount: z.number().int().nonnegative().max(WHITEBOARD_LIMITS.objects),
  pageOrder: z.array(WhiteboardObjectId).max(BOARD_FILE_EXPORT_LIMITS.pages),
  losses: z.array(BoardFileExportLoss).max(20),
  sizeBytes: z.number().int().nonnegative().max(BOARD_FILE_EXPORT_LIMITS.bytes).nullable(),
  errorCode: z.enum(['BOUNDS_EXCEEDED', 'GENERATION_FAILED']).nullable(),
}).strict();
export type BoardFileExportStatus = z.infer<typeof BoardFileExportStatus>;

export const operations = {
  create: { method: 'POST', path: '/whiteboards/:boardId/file-exports', in: BoardFileExportInput, out: BoardFileExportStatus },
  status: { method: 'GET', path: '/whiteboard-file-exports/:jobId', out: BoardFileExportStatus },
  cancel: { method: 'DELETE', path: '/whiteboard-file-exports/:jobId', out: BoardFileExportStatus },
  content: { method: 'GET', path: '/whiteboard-file-exports/:jobId/content' },
} as const;
