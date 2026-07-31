/**
 * F33 -- 批量 zip 导出：`createExportJob` / `getExportJob`。
 *
 * ## 🔴 What this file honestly does NOT deliver: a real async pipeline
 *
 * The contract's `ExportJobStatus` is `queued | running | done | failed`, and the UI copy
 * ("异步导出任务，不阻塞界面", uc-22-1 R9) describes a queue + worker. This implementation
 * builds the zip SYNCHRONOUSLY inside `createExportJob` -- there is no worker, no queue table
 * row that starts life as `queued` and is later flipped. That is a real shortfall against R9's
 * non-functional expectation, not a hidden one: it is written here, and `ExportJobRepository`'s
 * header states it again next to the one method that writes a job row (`saveDone`, always
 * "done" or the call throws before anything is persisted). What IS delivered, and is the part
 * the three signed verification files actually check, is the STRUCTURAL claim (V4): zip
 * directory layout ≡ tree grouping, `manifest.json` sha256 per file, file count = manifest
 * entry count, and a threshold that rejects rather than truncates.
 *
 * ## Why failure never leaves a half-built zip
 *
 * Every step that can fail (selection resolution, threshold check, byte fetch) happens BEFORE
 * `objectStore.putOnce` is called. Nothing is written to object storage until the archive is
 * fully assembled in memory, so "临时对象被清理" is true trivially -- there is never a partial
 * object to clean up in the first place.
 */
import { createHash } from "node:crypto";
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { buildManifest, MAX_EXPORT_ITEMS, uniqueZipPaths, type ManifestSourceRow } from "../../domain/files/export-manifest";
import { mintDownloadToken, downloadExpiry } from "../../domain/files/download-grant";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed, type Disclosed } from "../security/permission-filter";
import type { ObjectStore, IdFactory } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { DownloadUrlBuilder } from "./download-ports";
import type {
  ExportContentRepository, ExportJobRepository, ExportSelection, ZipBuilder, ZipEntry,
} from "./export-ports";
import type { Guarded } from "../security/permission-filter";

export type CreateExportJobResult = z.infer<typeof C.operations.createExportJob.out>;
export type GetExportJobResult = z.infer<typeof C.operations.getExportJob.out>;

export type ExportReasonCode = "NO_PROJECT_ROLE" | "EXPORT_LIMIT_EXCEEDED" | "DEPENDENCY_UNAVAILABLE";

export class FilesExportError extends Error {
  constructor(readonly reasonCode: ExportReasonCode) {
    super("files_export_failed");
  }
}

export interface ExportDeps extends AuthorizeDeps {
  readonly exportContent: ExportContentRepository;
  readonly objectStore: ObjectStore;
  readonly jobs: ExportJobRepository;
  readonly urls: DownloadUrlBuilder;
  readonly provenance: ProvenanceWriter;
  readonly idFactory: IdFactory;
  readonly zip: ZipBuilder;
  readonly now: () => Date;
}

/** Same action the browser and F32 delivery use -- an export is a bulk read, not a new gate. */
const EXPORT_ACTION = "read.allHands";

export async function createExportJob(
  deps: ExportDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly artifactIds: readonly string[] | null;
    readonly treeNodeId: string | null;
  },
): Promise<CreateExportJobResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: EXPORT_ACTION,
  });
  if (!decision.allowed) throw new FilesExportError("NO_PROJECT_ROLE");

  /**
   * ⚠ Selection resolution is a judgement call, reported rather than silently picked.
   *
   * The signed contract offers `artifactIds | treeNodeId` as "二选一", but does not say what an
   * implementation owes when BOTH are non-null or BOTH are null:
   *   - both non-null  -> `artifactIds` wins (the more specific, explicitly-checked selection).
   *   - both null      -> the WHOLE visible tree is selected ("导出为 zip" with nothing picked
   *                        reads as "export everything I can see", matching the UI's top-level
   *                        `files-export-zip` button which has no per-row selection state).
   * See the PR description for this feature; this is not a ruling on R10's unresolved items.
   */
  const selection: ExportSelection = {
    artifactIds: input.artifactIds,
    treeNodeId: input.artifactIds === null ? input.treeNodeId : null,
  };

  const guarded = await deps.exportContent.visibleExportRows({
    orgId: input.orgId,
    projectId: input.projectId,
    requesterTeamId: membership?.teamId ?? null,
    selection,
  });
  const exportRows = unwrapExportable(guarded, decision);

  // ⚠ Checked BEFORE any byte leaves PostgreSQL metadata, let alone object storage -- E2·22-1:
  // "超阈值拒绝，不静默截断". [待定 T-10]: MAX_EXPORT_ITEMS is a placeholder, see its doc comment.
  if (exportRows.length > MAX_EXPORT_ITEMS) throw new FilesExportError("EXPORT_LIMIT_EXCEEDED");

  const now = deps.now();
  const paths = uniqueZipPaths(exportRows);

  // Fetch every file's bytes FIRST, entirely in memory, before any write to object storage.
  // A missing object here means the export cannot honestly claim "file-first, round-trip
  // complete" -- it is reported as DEPENDENCY_UNAVAILABLE (same code F31/F32 use for "the
  // object store did not have what PostgreSQL said it should"), and nothing is persisted.
  const zipEntries: ZipEntry[] = [];
  const manifestRows: ManifestSourceRow[] = [];
  for (const row of exportRows) {
    const bytes = await deps.objectStore.get(row.objectKey);
    if (bytes === null) throw new FilesExportError("DEPENDENCY_UNAVAILABLE");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = paths.get(row.artifactId)!;
    zipEntries.push({ path, content: bytes });
    manifestRows.push({
      artifactId: row.artifactId,
      name: row.name,
      sourceType: row.sourceType,
      agendaSegmentId: row.agendaSegmentId,
      confidential: row.confidential,
      versionNumber: row.versionNumber,
      sha256,
    });
  }

  const manifest = buildManifest(manifestRows, paths, now);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

  const zipBytes = deps.zip.build([{ path: "manifest.json", content: manifestBytes }, ...zipEntries]);

  const jobId = deps.idFactory.next("exp");
  const objectKey = `${input.orgId}/exports/${input.projectId}/${jobId}.zip`;
  await deps.objectStore.putOnce(objectKey, zipBytes, "application/zip");

  const token = mintDownloadToken();
  const expiresAt = downloadExpiry(now);
  const downloadUrl = deps.urls.build(token.raw);

  await deps.jobs.saveDone({
    jobId,
    orgId: input.orgId,
    projectId: input.projectId,
    requestedBy: input.userId,
    itemCount: exportRows.length,
    objectKey,
    manifestSha256,
    downloadUrl,
    expiresAt,
  });

  // 「导出本身写审计」. ⚠ Reuses `downloaded` (no dedicated `exported` member exists in the
  // closed `provenance.ProvenanceEventType` enum -- adding a fourth member needs an ADR, same
  // situation ADR-101 already covers for `files`/`project`/`chat`; ratifying a NEW member here
  // rather than reusing an existing one is a human call, not this feature's to make). `detail`
  // carries `purpose: "export"` so a reader can tell this apart from a single-file download.
  await deps.provenance.append({
    orgId: input.orgId,
    type: "downloaded",
    actorId: input.userId,
    target: { kind: "project", id: input.projectId },
    detail: {
      purpose: "export",
      jobId,
      itemCount: exportRows.length,
      manifestSha256,
      artifactIds: exportRows.map((r) => r.artifactId),
    },
  });

  return { jobId, status: "done" };
}

export async function getExportJob(
  deps: ExportDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly jobId: string },
): Promise<GetExportJobResult> {
  const found = await deps.jobs.findById({ orgId: input.orgId, jobId: input.jobId });
  if (found === null) throw new FilesExportError("NO_PROJECT_ROLE");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId,
    object: { kind: "project", id: found.projectId },
    action: EXPORT_ACTION,
  });
  if (!decision.allowed) throw new FilesExportError("NO_PROJECT_ROLE");

  return found.job;
}

/**
 * Unwrap rows already cleared by the requester-level decision.
 *
 * Same shape as `browse-artifacts.ts`'s `unwrap` -- kept as a separate, concretely-typed copy
 * rather than a shared generic because the two callers' `Guarded<T>` payloads are different
 * types and a shared helper would need a type parameter with no behaviour difference to earn
 * its indirection.
 */
function unwrapExportable<T>(
  items: readonly Guarded<T>[],
  decision: { allowed: boolean; decisionId: string },
): T[] {
  const out: T[] = [];
  for (const g of items) {
    const r = discloseDecided(g, decision as Parameters<typeof discloseDecided>[1]);
    if (isDisclosed(r)) out.push((r as Disclosed<T>).payload);
  }
  return out;
}
