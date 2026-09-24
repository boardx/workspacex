import { z } from "zod";
import { BoardId } from "./whiteboard";
import { ExternalImportPreview } from "./whiteboard-migration";
import { ImportBoardInput, ImportBoardPreview } from "./whiteboard-transfer";
export const MURAL_DIRECT_IMPORT = {
  scopes: ["workspaces:read", "murals:read"] as const,
  pageLimit: 50,
  widgetPageLimit: 100,
  maxWidgets: 10_000,
  maxResponseBytes: 16 * 1024 * 1024,
} as const;

/** Mural Public API wire responses; infrastructure parses this single contract source. */
export const MuralTokenResponse = z.object({
  access_token: z.string().min(1).max(16_384),
  refresh_token: z.string().min(1).max(16_384).nullable().optional(),
  expires_in: z.number().int().positive().max(31_536_000).optional(),
  scope: z.string().max(2_000).optional(),
}).passthrough();

export const MuralRemoteNamed = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  updatedOn: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
  updatedAt: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
}).passthrough().refine(value => Boolean(value.name || value.title));

export const MuralRemotePage = z.object({
  value: z.array(MuralRemoteNamed).max(MURAL_DIRECT_IMPORT.pageLimit),
  next: z.string().min(1).max(2_000).nullable().optional(),
}).passthrough();

export const MuralRemoteWidgetPage = z.object({
  value: z.array(z.record(z.unknown())).max(MURAL_DIRECT_IMPORT.widgetPageLimit),
  next: z.string().min(1).max(2_000).nullable().optional(),
}).passthrough();

export const MuralRemoteDetailEnvelope = z.object({ value: MuralRemoteNamed }).passthrough();
const SafeReturnTo = z
  .string()
  .min(1)
  .max(500)
  .regex(/^\/studio\/board(?:\/[^?#]*)?(?:\?[^#]*)?$/);
const Id = z.string().trim().min(1).max(256),
  Next = z.string().min(1).max(2_000).nullable();
export const MuralConnection = z
  .object({
    connected: z.boolean(),
    scopes: z.array(z.string().max(100)).max(20),
    connectedAt: z.string().datetime().nullable(),
  })
  .strict();
export type MuralConnection = z.infer<typeof MuralConnection>;
export const StartMuralOAuthInput = z
  .object({ returnTo: SafeReturnTo })
  .strict();
export type StartMuralOAuthInput = z.infer<typeof StartMuralOAuthInput>;
export const StartMuralOAuthResult = z
  .object({ authorizationUrl: z.string().url() })
  .strict();
export const CompleteMuralOAuthInput = z
  .object({
    state: z.string().min(1).max(500),
    code: z.string().min(1).max(8192),
  })
  .strict();
export type CompleteMuralOAuthInput = z.infer<typeof CompleteMuralOAuthInput>;
export const CompleteMuralOAuthResult = z
  .object({ returnTo: SafeReturnTo })
  .strict();
export const MuralWorkspace = z
  .object({ id: Id, name: z.string().trim().min(1).max(200) })
  .strict();
export type MuralWorkspace = z.infer<typeof MuralWorkspace>;
export const MuralSummary = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(200),
    modifiedAt: z.string().datetime().nullable(),
  })
  .strict();
export type MuralSummary = z.infer<typeof MuralSummary>;
export const PageQuery = z
  .object({
    next: z.string().min(1).max(2000).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MURAL_DIRECT_IMPORT.pageLimit)
      .default(MURAL_DIRECT_IMPORT.pageLimit),
  })
  .strict();
export const ListMuralWorkspacesResult = z
  .object({
    items: z.array(MuralWorkspace).max(MURAL_DIRECT_IMPORT.pageLimit),
    next: Next,
  })
  .strict();
export type ListMuralWorkspacesResult = z.infer<
  typeof ListMuralWorkspacesResult
>;
export const ListWorkspaceMuralsQuery = PageQuery.extend({
  workspaceId: Id,
}).strict();
export const ListWorkspaceMuralsResult = z
  .object({
    items: z.array(MuralSummary).max(MURAL_DIRECT_IMPORT.pageLimit),
    next: Next,
  })
  .strict();
export type ListWorkspaceMuralsResult = z.infer<
  typeof ListWorkspaceMuralsResult
>;
export const PreviewMuralInput = z
  .object({ muralId: Id, packageBoardId: BoardId })
  .strict();
export type PreviewMuralInput = z.infer<typeof PreviewMuralInput>;
export const PreviewMuralResult = z
  .object({
    input: ImportBoardInput,
    external: ExternalImportPreview,
    preview: ImportBoardPreview,
  })
  .strict();
export type PreviewMuralResult = z.infer<typeof PreviewMuralResult>;
export const operations = {
  connection: {
    method: "GET",
    path: "/whiteboards/mural/connection",
    out: MuralConnection,
  },
  startOAuth: {
    method: "POST",
    path: "/whiteboards/mural/oauth/start",
    in: StartMuralOAuthInput,
    out: StartMuralOAuthResult,
  },
  completeOAuth: {
    method: "POST",
    path: "/whiteboards/mural/oauth/callback",
    in: CompleteMuralOAuthInput,
    out: CompleteMuralOAuthResult,
  },
  listWorkspaces: {
    method: "GET",
    path: "/whiteboards/mural/workspaces",
    query: PageQuery,
    out: ListMuralWorkspacesResult,
  },
  listMurals: {
    method: "GET",
    path: "/whiteboards/mural/murals",
    query: ListWorkspaceMuralsQuery,
    out: ListWorkspaceMuralsResult,
  },
  preview: {
    method: "POST",
    path: "/whiteboards/mural/imports/preview",
    in: PreviewMuralInput,
    out: PreviewMuralResult,
  },
  disconnect: {
    method: "DELETE",
    path: "/whiteboards/mural/connection",
    out: z.object({ disconnected: z.literal(true) }).strict(),
  },
} as const;
