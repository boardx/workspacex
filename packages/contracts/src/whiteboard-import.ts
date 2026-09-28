import { z } from 'zod';
import { BoardId } from './whiteboard';

export const WHITEBOARD_IMPORT_LIMITS = {
  uploadBytes: 32 * 1024 * 1024, files: 500, pathDepth: 8,
  entryBytes: 16 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024,
  compressionRatio: 100, objects: 200, issues: 1000,
} as const;
export const WhiteboardImportId = z.string().uuid();
export const WhiteboardImportSource = z.enum(['miro', 'mural']);
export type WhiteboardImportSource = z.infer<typeof WhiteboardImportSource>;
export const WhiteboardImportMime = z.enum(['application/json', 'text/csv', 'application/zip']);
export const WhiteboardImportStage = z.enum(['uploaded', 'preflighted', 'completed', 'failed']);
export const WhiteboardImportIssueCode = z.enum([
  'UNSUPPORTED_ITEM', 'INVALID_REFERENCE', 'OBJECT_LIMIT', 'ASSET_UNSUPPORTED',
  'ASSET_MISSING', 'VALUE_NORMALIZED', 'FILE_SKIPPED',
]);
export const WhiteboardImportFailure = z.enum([
  'NOT_FOUND', 'FORBIDDEN', 'ARCHIVED', 'INVALID_UPLOAD', 'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FORMAT', 'UNSAFE_ARCHIVE', 'INTEGRITY_FAILED', 'STALE_HEAD',
  'IDEMPOTENCY_CONFLICT', 'DEPENDENCY_UNAVAILABLE', 'UPLOAD_CANCELLED',
  'CONTENT_REJECTED',
]);
export type WhiteboardImportFailure = z.infer<typeof WhiteboardImportFailure>;
export const WhiteboardImportIssue = z.object({
  code: WhiteboardImportIssueCode, sourceId: z.string().max(256).nullable(),
  sourceType: z.string().max(128).nullable(), detail: z.string().max(1000),
}).strict();
export const WhiteboardImportItemResult = z.object({
  sourceId: z.string().max(256), sourceType: z.string().max(128),
  outcome: z.enum(['success', 'downgraded', 'skipped', 'failed']),
  reasonCode: z.string().min(1).max(64).nullable(), detail: z.string().max(1000).nullable(),
}).strict();
export const WhiteboardImportCounts = z.object({
  discovered: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(), assets: z.number().int().nonnegative(),
}).strict();
export const WhiteboardImportStatus = z.object({
  importId: WhiteboardImportId, boardId: BoardId, source: WhiteboardImportSource,
  sourceBoardId: z.string().min(1).max(256), sourceRevision: z.string().min(1).max(256),
  fileName: z.string().min(1).max(255), mimeType: WhiteboardImportMime,
  sizeBytes: z.number().int().nonnegative().max(WHITEBOARD_IMPORT_LIMITS.uploadBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), stage: WhiteboardImportStage,
  counts: WhiteboardImportCounts.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type WhiteboardImportStatus = z.infer<typeof WhiteboardImportStatus>;
export const WhiteboardImportReport = z.object({
  importId: WhiteboardImportId, counts: WhiteboardImportCounts,
  issues: z.array(WhiteboardImportIssue).max(WHITEBOARD_IMPORT_LIMITS.issues),
  items: z.array(WhiteboardImportItemResult).max(WHITEBOARD_IMPORT_LIMITS.objects),
  exportFormat: z.literal('workspacex.whiteboard-import-report.v1'),
  executable: z.boolean(),
}).strict();
export type WhiteboardImportReport = z.infer<typeof WhiteboardImportReport>;
export const WhiteboardImportUploadDescriptor = z.object({
  requestId: WhiteboardImportId, source: WhiteboardImportSource,
  fileName: z.string().min(1).max(255), mimeType: WhiteboardImportMime,
  sizeBytes: z.number().int().positive().max(WHITEBOARD_IMPORT_LIMITS.uploadBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const UploadWhiteboardImport = WhiteboardImportUploadDescriptor.extend({
  contentBase64: z.string().min(4).max(Math.ceil(WHITEBOARD_IMPORT_LIMITS.uploadBytes / 3) * 4),
}).strict();
export const WhiteboardImportAction = z.object({ requestId: z.string().uuid() }).strict();
export const ExecuteWhiteboardImport = WhiteboardImportAction.extend({ expectedEpoch: z.number().int().positive() }).strict();
export const StandardWhiteboardExportRequest = z.object({ requestId: z.string().uuid() }).strict();
export const StandardWhiteboardExport = z.object({
  format:z.literal('workspacex.board.v1'), exportId:z.string().uuid(), boardId:BoardId,
  epoch:z.number().int().positive(), seq:z.number().int().nonnegative(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/), sizeBytes:z.number().int().positive(),
  fileName:z.string().min(1).max(255), objectKey:z.string().min(1).max(2048),
  downloadPath:z.string().startsWith('/whiteboards/'), replayed:z.boolean(),
  contentBase64:z.string().optional(),
}).strict();
export const StandardWhiteboardExportDownload = StandardWhiteboardExport.omit({ replayed:true }).extend({ contentBase64:z.string().min(4) }).strict();

export const operations = {
  upload: { method: 'POST', path: '/whiteboards/:boardId/imports', in: UploadWhiteboardImport, out: WhiteboardImportStatus, err: WhiteboardImportFailure.options },
  preflight: { method: 'POST', path: '/whiteboards/:boardId/imports/:importId/preflight', in: WhiteboardImportAction, out: WhiteboardImportReport, err: WhiteboardImportFailure.options },
  execute: { method: 'POST', path: '/whiteboards/:boardId/imports/:importId/execute', in: ExecuteWhiteboardImport, out: z.object({ status: WhiteboardImportStatus, report: WhiteboardImportReport, epoch: z.number().int().positive(), seq: z.number().int().nonnegative(), replayed: z.boolean() }).strict(), err: WhiteboardImportFailure.options },
  status: { method: 'GET', path: '/whiteboards/:boardId/imports/:importId', in: z.object({ boardId: BoardId, importId: WhiteboardImportId }).strict(), out: WhiteboardImportStatus, err: WhiteboardImportFailure.options },
  report: { method: 'GET', path: '/whiteboards/:boardId/imports/:importId/report', in: z.object({ boardId: BoardId, importId: WhiteboardImportId }).strict(), out: WhiteboardImportReport, err: WhiteboardImportFailure.options },
  standardExport:{method:'POST',path:'/whiteboards/:boardId/imports/standard-export',in:StandardWhiteboardExportRequest,out:StandardWhiteboardExport,err:WhiteboardImportFailure.options},
  downloadStandardExport:{method:'GET',path:'/whiteboards/:boardId/imports/standard-export/:exportId',in:z.object({boardId:BoardId,exportId:z.string().uuid()}).strict(),out:StandardWhiteboardExportDownload,err:WhiteboardImportFailure.options},
} as const;
