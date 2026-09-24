import { z } from 'zod';
import { BoardId } from './whiteboard';
import { ExternalImportPreview } from './whiteboard-migration';
import { ImportBoardInput, ImportBoardPreview } from './whiteboard-transfer';

export const MIRO_DIRECT_IMPORT = {
  scope: 'boards:read',
  boardPageLimit: 50,
  itemPageLimit: 50,
  maxItems: 10_000,
  maxResponseBytes: 16 * 1024 * 1024,
} as const;

const SafeReturnTo = z.string().min(1).max(500).regex(/^\/studio\/board(?:\/[^?#]*)?(?:\?[^#]*)?$/);
const MiroId = z.string().trim().min(1).max(256);

export const MiroConnection = z.object({
  connected: z.boolean(),
  scopes: z.array(z.string().max(100)).max(20),
  connectedAt: z.string().datetime().nullable(),
}).strict();
export type MiroConnection = z.infer<typeof MiroConnection>;

export const StartMiroOAuthInput = z.object({ returnTo: SafeReturnTo }).strict();
export type StartMiroOAuthInput = z.infer<typeof StartMiroOAuthInput>;
export const StartMiroOAuthResult = z.object({ authorizationUrl: z.string().url() }).strict();
export const CompleteMiroOAuthInput = z.object({
  state: z.string().min(1).max(500),
  code: z.string().min(1).max(8_192),
}).strict();
export type CompleteMiroOAuthInput = z.infer<typeof CompleteMiroOAuthInput>;
export const CompleteMiroOAuthResult = z.object({ returnTo: SafeReturnTo }).strict();

export const MiroBoard = z.object({
  id: MiroId,
  name: z.string().trim().min(1).max(200),
  modifiedAt: z.string().datetime().nullable(),
}).strict();
export type MiroBoard = z.infer<typeof MiroBoard>;

export const ListMiroBoardsQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(MIRO_DIRECT_IMPORT.boardPageLimit).default(MIRO_DIRECT_IMPORT.boardPageLimit),
}).strict();
export const ListMiroBoardsResult = z.object({
  items: z.array(MiroBoard).max(MIRO_DIRECT_IMPORT.boardPageLimit),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(MIRO_DIRECT_IMPORT.boardPageLimit),
  hasMore: z.boolean(),
}).strict();
export type ListMiroBoardsResult = z.infer<typeof ListMiroBoardsResult>;

export const PreviewMiroBoardInput = z.object({
  boardId: MiroId,
  packageBoardId: BoardId,
}).strict();
export type PreviewMiroBoardInput = z.infer<typeof PreviewMiroBoardInput>;
export const PreviewMiroBoardResult = z.object({
  input: ImportBoardInput,
  external: ExternalImportPreview,
  preview: ImportBoardPreview,
}).strict();
export type PreviewMiroBoardResult = z.infer<typeof PreviewMiroBoardResult>;

export const operations = {
  connection: { method: 'GET', path: '/whiteboards/miro/connection', out: MiroConnection },
  startOAuth: { method: 'POST', path: '/whiteboards/miro/oauth/start', in: StartMiroOAuthInput, out: StartMiroOAuthResult },
  completeOAuth: { method: 'POST', path: '/whiteboards/miro/oauth/callback', in: CompleteMiroOAuthInput, out: CompleteMiroOAuthResult },
  listBoards: { method: 'GET', path: '/whiteboards/miro/boards', query: ListMiroBoardsQuery, out: ListMiroBoardsResult },
  previewBoard: { method: 'POST', path: '/whiteboards/miro/imports/preview', in: PreviewMiroBoardInput, out: PreviewMiroBoardResult },
  disconnect: { method: 'DELETE', path: '/whiteboards/miro/connection', out: z.object({ disconnected: z.literal(true) }).strict() },
} as const;
