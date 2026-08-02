/**
 * F354 -- typed wrappers over the four REAL files controllers, for the file browser page to
 * stop reading `apps/web/lib/mock/files.ts` for its data. Follows the F122 pattern
 * (`apps/web/lib/live-projects.ts`): types derived from `@repo/contracts`, no second
 * declaration of the response shapes.
 *
 * ## What this file intentionally does NOT wire, and why
 *
 * `files.FileNode` (the row `listProjectArtifacts` / `getArtifactTree` return) carries
 * `artifactId`, not a `versionId`. `previewArtifactVersion` and `issueDownloadUrl` both take a
 * `versionId`. There is no operation in this contract that maps an artifact to its current
 * version id -- `listVersions` (which would supply it) has no controller in this backend yet
 * (only files-browser / files-delivery / files-export / files-rename are wired; F34's sibling
 * read route `GET /artifacts/:artifactId/file-versions` does not exist as a route here).
 *
 * ⇒ Preview and single-file download cannot be honestly wired from the browser's list/tree
 *   response alone. Rather than guess a `versionId` (e.g. assume it equals `artifactId`, which
 *   is not what the domain says), this is reported as a gap in the PR and left unimplemented.
 *   `issueDownloadUrl` / `previewArtifactVersion` wrappers are still exported here so the next
 *   feature that has a real `versionId` (e.g. from a future `listVersions` route) does not have
 *   to re-invent this client.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type FileNode = z.infer<typeof C.FileNode>;
export type TreeNode = z.infer<typeof C.TreeNode>;
export type ListArtifactsOut = z.infer<typeof C.operations.listProjectArtifacts.out>;
export type ArtifactTreeOut = z.infer<typeof C.operations.getArtifactTree.out>;
export type SearchArtifactsOut = z.infer<typeof C.operations.searchArtifacts.out>;
export type PreviewOut = z.infer<typeof C.operations.previewArtifactVersion.out>;
export type IssueDownloadUrlOut = z.infer<typeof C.operations.issueDownloadUrl.out>;
export type CreateExportJobOut = z.infer<typeof C.operations.createExportJob.out>;
export type GetExportJobOut = z.infer<typeof C.operations.getExportJob.out>;
export type RenameArtifactOut = z.infer<typeof C.operations.renameArtifact.out>;
export type ResolveAliasOut = z.infer<typeof C.operations.resolveArtifactAlias.out>;

export interface ListArtifactsFilters {
  readonly sourceType: readonly string[];
  readonly agendaSegmentId: readonly string[];
  readonly timeRange: { readonly from: string; readonly to: string } | null;
  readonly uploader: { readonly type: "user" | "agent"; readonly id: string } | null;
  readonly confidential: boolean | null;
  readonly ingestionState: readonly z.infer<(typeof C.FileNode)["shape"]["ingestionStatus"]>[];
}

/** `?filters=` travels as one JSON query param -- see `files-browser.controller.ts`'s header. */
export async function listProjectArtifacts(
  projectId: string,
  opts: {
    view?: "tree" | "list";
    filters?: ListArtifactsFilters | null;
    cursor?: string | null;
    pageSize?: number | null;
  } = {},
): Promise<ListArtifactsOut> {
  return apiRequest<ListArtifactsOut>(`/projects/${encodeURIComponent(projectId)}/artifacts`, {
    method: "GET",
    query: {
      view: opts.view ?? "list",
      filters: opts.filters ? JSON.stringify(opts.filters) : undefined,
      cursor: opts.cursor ?? undefined,
      pageSize: opts.pageSize != null ? String(opts.pageSize) : undefined,
    },
  });
}

export async function getArtifactTree(projectId: string): Promise<ArtifactTreeOut> {
  return apiRequest<ArtifactTreeOut>(`/projects/${encodeURIComponent(projectId)}/artifact-tree`, {
    method: "GET",
  });
}

export async function searchArtifacts(projectId: string, q: string): Promise<SearchArtifactsOut> {
  return apiRequest<SearchArtifactsOut>(`/projects/${encodeURIComponent(projectId)}/artifacts/search`, {
    method: "GET",
    query: { q },
  });
}

/**
 * ⚠ Exported for a future caller that has a real `versionId`. Not called anywhere yet --
 * see the file header.
 */
export async function previewArtifactVersion(versionId: string): Promise<PreviewOut> {
  return apiRequest<PreviewOut>(`/artifact-versions/${encodeURIComponent(versionId)}/preview`, {
    method: "GET",
  });
}

/** ⚠ Same caveat as `previewArtifactVersion` -- not called anywhere yet. */
export async function issueDownloadUrl(
  versionId: string,
  purpose: "download" | "export" = "download",
): Promise<IssueDownloadUrlOut> {
  return apiRequest<IssueDownloadUrlOut>(`/artifact-versions/${encodeURIComponent(versionId)}/download-url`, {
    method: "POST",
    query: { purpose },
  });
}

/**
 * `artifactIds === null` (or an empty selection) means "export everything visible" -- the same
 * ruling `application/files/export-artifacts.ts`'s `createExportJob` documents for `both null`,
 * and the one the browser's top-level export button (no per-row selection) already implied
 * before this feature added row checkboxes. A non-empty `artifactIds` scopes the export to
 * exactly that set; `treeNodeId` is left null here -- no caller in this app selects by tree node.
 */
export async function createExportJob(
  projectId: string,
  artifactIds: readonly string[] | null = null,
): Promise<CreateExportJobOut> {
  return apiRequest<CreateExportJobOut>(`/projects/${encodeURIComponent(projectId)}/export-jobs`, {
    method: "POST",
    body: {
      projectId,
      artifactIds: artifactIds !== null && artifactIds.length > 0 ? artifactIds : null,
      treeNodeId: null,
    },
  });
}

export async function getExportJob(jobId: string): Promise<GetExportJobOut> {
  return apiRequest<GetExportJobOut>(`/export-jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}

export async function renameArtifact(
  artifactId: string,
  newName: string,
  reason: string,
): Promise<RenameArtifactOut> {
  return apiRequest<RenameArtifactOut>(`/artifacts/${encodeURIComponent(artifactId)}/rename`, {
    method: "POST",
    query: { newName, reason },
  });
}

export async function resolveArtifactAlias(projectId: string, path: string): Promise<ResolveAliasOut> {
  return apiRequest<ResolveAliasOut>(`/artifact-aliases/resolve`, {
    method: "GET",
    query: { projectId, path },
  });
}
