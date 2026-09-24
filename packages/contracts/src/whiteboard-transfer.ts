import { z } from 'zod';
import { Board, BoardId, CreateBoard } from './whiteboard';
import { WHITEBOARD_LIMITS, WhiteboardObject } from './whiteboard-document';

export const PORTABLE_BOARD = {
  format: 'workspacex.board',
  schemaVersion: 1,
  maxBytes: 16 * 1024 * 1024,
} as const;

export const PortableBoardPackage = z.object({
  format: z.literal(PORTABLE_BOARD.format),
  schemaVersion: z.literal(PORTABLE_BOARD.schemaVersion),
  exportedAt: z.string().datetime(),
  source: z.object({
    application: z.literal('WorkspaceX'),
    boardId: BoardId,
    name: z.string().trim().min(1).max(200),
  }).strict(),
  objects: z.array(WhiteboardObject).max(WHITEBOARD_LIMITS.objects),
  provenance: z.object({
    objectCount: z.number().int().nonnegative().max(WHITEBOARD_LIMITS.objects),
    contentModel: z.literal('whiteboard-object.v1'),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.provenance.objectCount !== value.objects.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provenance', 'objectCount'], message: 'Object count does not match payload' });
  }
});
export type PortableBoardPackage = z.infer<typeof PortableBoardPackage>;

export const ImportBoardInput = z.object({
  requestId: CreateBoard.shape.requestId,
  name: Board.shape.name.optional(),
  package: PortableBoardPackage,
}).strict();
export type ImportBoardInput = z.infer<typeof ImportBoardInput>;

export const ImportBoardPreview = z.object({
  sourceName: Board.shape.name,
  destinationName: Board.shape.name,
  objectCount: z.number().int().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
  connectorCount: z.number().int().nonnegative(),
  identitiesRemapped: z.number().int().nonnegative(),
  contentLosses: z.array(z.object({ code: z.string().max(64), count: z.number().int().positive(), message: z.string().max(300) }).strict()).max(20),
}).strict();
export type ImportBoardPreview = z.infer<typeof ImportBoardPreview>;

export const ImportBoardResult = z.object({
  board: Board,
  importedObjects: z.number().int().nonnegative(),
  remappedObjects: z.number().int().nonnegative(),
  replayed: z.boolean(),
}).strict();

export const operations = {
  exportBoard: { method: 'GET', path: '/whiteboards/:boardId/export', out: PortableBoardPackage },
  previewImport: { method: 'POST', path: '/whiteboards/imports/preview', in: ImportBoardInput, out: ImportBoardPreview },
  importBoard: { method: 'POST', path: '/whiteboards/imports', in: ImportBoardInput, out: ImportBoardResult },
} as const;
