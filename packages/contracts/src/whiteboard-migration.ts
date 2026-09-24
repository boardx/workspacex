import { z } from 'zod';
import { BoardId } from './whiteboard';
import { WHITEBOARD_LIMITS } from './whiteboard-document';
import { ImportQualitySummary, PortableBoardPackage } from './whiteboard-transfer';

export const EXTERNAL_BOARD_IMPORT = {
  maxBytes: 16 * 1024 * 1024,
  maxObjects: WHITEBOARD_LIMITS.objects,
} as const;

const ExternalId = z.string().trim().min(1).max(256);
const ExternalName = z.string().trim().min(1).max(200);
const Color = z.string().max(64).regex(/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl)a?\([0-9.,%\s+-]+\))$/);
const Geometry = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().positive().max(100_000),
  height: z.number().finite().positive().max(100_000),
  rotation: z.number().finite().min(-360).max(360).optional(),
}).strict();
const MiroPosition = z.object({
  x: Geometry.shape.x, y: Geometry.shape.y,
  origin: z.string().max(64).optional(), relativeTo: z.string().max(64).optional(),
}).strict();
const ExternalStyle = z.object({ fillColor: Color.optional(), textColor: Color.optional(), backgroundColor: Color.optional() }).passthrough();

const MiroItem = z.object({
  id: ExternalId,
  type: z.string().trim().min(1).max(64),
  content: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(),
  position: z.union([Geometry, MiroPosition]).optional(),
  geometry: z.object({ width: Geometry.shape.width, height: Geometry.shape.height, rotation: Geometry.shape.rotation }).strict().optional(),
  data: z.object({ content: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(), title: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(), shape: z.string().max(64).optional() }).passthrough().optional(),
  style: ExternalStyle.optional(),
  parentId: ExternalId.optional(),
  parent: z.object({ id: ExternalId }).strict().optional(),
  shape: z.enum(['rectangle', 'ellipse']).optional(),
  fillColor: Color.optional(),
  textColor: Color.optional(),
  startItemId: ExternalId.optional(),
  endItemId: ExternalId.optional(),
  startConnection: z.object({ item: ExternalId }).strict().optional(),
  endConnection: z.object({ item: ExternalId }).strict().optional(),
}).passthrough();

export const MiroBoardSnapshotV1 = z.object({
  format: z.literal('miro.rest.board-snapshot'),
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  board: z.object({ id: ExternalId, name: ExternalName }).strict(),
  pages: z.array(z.object({ id: ExternalId, name: z.string().max(200).optional(), items: z.array(MiroItem).max(EXTERNAL_BOARD_IMPORT.maxObjects) }).strict()).min(1).max(100),
}).strict();
export type MiroBoardSnapshotV1 = z.infer<typeof MiroBoardSnapshotV1>;

const MuralWidget = z.object({
  id: ExternalId,
  type: z.string().trim().min(1).max(64),
  text: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(),
  position: Geometry.optional(),
  x: Geometry.shape.x.optional(), y: Geometry.shape.y.optional(),
  width: Geometry.shape.width.optional(), height: Geometry.shape.height.optional(), rotation: Geometry.shape.rotation,
  parentId: ExternalId.optional(),
  relativeToParent: z.boolean().optional(),
  shape: z.enum(['rectangle', 'ellipse']).optional(),
  fillColor: Color.optional(),
  textColor: Color.optional(),
  htmlText: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(),
  title: z.string().max(WHITEBOARD_LIMITS.text * 2).optional(),
  style: ExternalStyle.optional(),
  startWidgetId: ExternalId.optional(),
  endWidgetId: ExternalId.optional(),
  startRefId: ExternalId.optional(),
  endRefId: ExternalId.optional(),
}).passthrough();

export const MuralBoardSnapshotV1 = z.object({
  format: z.literal('mural.public-api.mural-snapshot'),
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  drawingsIncluded: z.literal(false).optional().default(false),
  mural: z.object({ id: ExternalId, name: ExternalName }).strict(),
  pages: z.array(z.object({ id: ExternalId, name: z.string().max(200).optional(), widgets: z.array(MuralWidget).max(EXTERNAL_BOARD_IMPORT.maxObjects) }).strict()).min(1).max(100),
}).strict();
export type MuralBoardSnapshotV1 = z.infer<typeof MuralBoardSnapshotV1>;

export const ExternalBoardSnapshot = z.union([MiroBoardSnapshotV1, MuralBoardSnapshotV1]);
export type ExternalBoardSnapshot = z.infer<typeof ExternalBoardSnapshot>;

export const ExternalImportLossCode = z.enum([
  'UNKNOWN_OBJECT', 'DANGLING_PARENT', 'DANGLING_CONNECTOR', 'DRAWING_UNSUPPORTED',
  'DRAWINGS_NOT_INCLUDED', 'FORMATTING_REMOVED', 'TEXT_TRUNCATED', 'POSITION_APPROXIMATED', 'INVALID_OBJECT',
  'VENDOR_DATA_OMITTED',
]);
export const ExternalImportLoss = z.object({
  code: ExternalImportLossCode,
  sourceObjectId: ExternalId.optional(),
  sourceType: z.string().max(64).optional(),
  message: z.string().min(1).max(300),
}).strict();
export type ExternalImportLoss = z.infer<typeof ExternalImportLoss>;

export const ExternalImportPreview = z.object({
  provider: z.enum(['miro', 'mural']),
  sourceBoardId: ExternalId,
  sourceName: ExternalName,
  importedObjectCount: z.number().int().nonnegative().max(EXTERNAL_BOARD_IMPORT.maxObjects),
  skippedObjectCount: z.number().int().nonnegative().max(EXTERNAL_BOARD_IMPORT.maxObjects),
  losses: z.array(ExternalImportLoss).max(EXTERNAL_BOARD_IMPORT.maxObjects * 5 + 1),
  quality: ImportQualitySummary,
}).strict().superRefine((value, ctx) => {
  const imported = value.quality.complete.count + value.quality.approximate.count + value.quality.degraded.count;
  if (imported !== value.importedObjectCount || value.quality.skipped.count !== value.skippedObjectCount) {
    ctx.addIssue({ code:z.ZodIssueCode.custom,path:['quality'],message:'Import quality must account for every source object' });
  }
});

export const ExternalImportConversion = z.object({
  package: PortableBoardPackage,
  preview: ExternalImportPreview,
}).strict();
export type ExternalImportConversion = z.infer<typeof ExternalImportConversion>;

export const ExternalImportOptions = z.object({ packageBoardId: BoardId }).strict();
export type ExternalImportOptions = z.infer<typeof ExternalImportOptions>;
