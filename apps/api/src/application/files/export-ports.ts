/**
 * F33 ports: the export job's read of "which visible artifacts, with what version/hash" and
 * the job record itself.
 *
 * Kept apart from F31's `ports.ts` for the same reason F32's `download-ports.ts` is: a
 * different concern (「哪些行进 zip、以什么字节」 vs 「哪些行你看得见」), sharing a single
 * repository file across F31/F32/F33 would grow one file nobody can reason about.
 *
 * ## Still ONE predicate
 *
 * `ExportContentRepository.visibleExportRows` joins the SAME `wsx_visible_artifacts()` F31/F32
 * already use (see `pg-artifact-browser-repository.ts`). An export must not be able to bundle a
 * file its requester could not see in the browser -- that would be a second, looser permission
 * surface hiding behind the "batch" button.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** One artifact, as the export needs it: enough to fetch bytes and to write a manifest row. */
export interface ExportableRow {
  readonly artifactId: string;
  readonly name: string;
  readonly sourceType: string;
  readonly agendaSegmentId: string | null;
  readonly confidential: boolean;
  readonly versionNumber: number;
  readonly objectKey: string;
  readonly contentHash: string;
  readonly mime: string;
}

/**
 * The selection `createExportJob.in` offers: an explicit id list, or a tree node.
 *
 * ⚠ `treeNodeId` is under-specified by the signed contract: `getArtifactTree`'s `TreeNode` has
 * no `level` field (see `artifact-tree.ts`'s header on why), so a bare string cannot say
 * whether it names a level-1 (source type) or level-2 (segment) node. This repository resolves
 * it against BOTH dimensions -- `sourceType = treeNodeId OR agendaSegmentId = treeNodeId`, with
 * the un-segmented sentinel matching a null segment -- which is a judgement call reported here
 * and in the F33 PR, not a ruling.
 */
export interface ExportSelection {
  readonly artifactIds: readonly string[] | null;
  readonly treeNodeId: string | null;
}

export interface ExportContentRepository {
  /**
   * Every visible artifact matching the selection, unpaginated.
   *
   * ⚠ Deliberately unpaginated: a partial fetch that silently caps at N rows is exactly the
   * "静默截断" V4/E2 forbids, just moved one layer down. The threshold check
   * (`MAX_EXPORT_ITEMS`) runs in the application layer against the FULL result, before any
   * byte is read from object storage.
   */
  visibleExportRows(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly requesterTeamId: string | null;
    readonly selection: ExportSelection;
  }): Promise<readonly Guarded<ExportableRow>[]>;
}

/** Derived from the signed contract, never restated -- `lint-contract-source.mjs` is the gate. */
export type ExportJobStatus = z.infer<typeof C.ExportJobStatus>;

export interface ExportJobRecord {
  readonly jobId: string;
  readonly status: ExportJobStatus;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly failureReason: string | null;
}

export interface NewExportJob {
  readonly jobId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly requestedBy: string;
  readonly itemCount: number;
  readonly objectKey: string;
  readonly manifestSha256: string;
  /**
   * ⚠ Built once, at creation time, and persisted verbatim -- NOT a bearer token to redeem
   * later. `issueDownloadUrl` (F32) hashes because a download link is a bearer credential for
   * ONE version and N-24 forbids it being forwardable; this operation's signed `err` list has
   * neither `DOWNLOAD_URL_EXPIRED` nor `DOWNLOAD_URL_CONSUMED`, so the contract itself does not
   * ask for that shape here. What IS missing, stated rather than hidden: no route in this
   * feature actually streams the zip's bytes from this URL -- `object_key` is real (the zip is
   * really in `ObjectStore`), but the HTTP redemption path is out of F33's three verification
   * tests and is left for the feature that wires a controller to it.
   */
  readonly downloadUrl: string;
  readonly expiresAt: Date;
}

export interface ExportJobRepository {
  /**
   * Persist a COMPLETED job in one write.
   *
   * ⚠ There is no separate "create queued, then update to done" path in this implementation.
   * `createExportJob` builds the zip synchronously (see `export-artifacts.ts`'s header for why
   * that is a stated, honest shortfall rather than a hidden one) and this method is only
   * called once the bytes are already in object storage -- so "queued"/"running" are contract
   * values this repository never writes, and a caller must not infer a real async pipeline
   * from their presence in `files.ExportJobStatus`.
   */
  saveDone(job: NewExportJob): Promise<void>;

  /** Looked up across any project the caller can see -- the requester gate runs on the result. */
  findById(input: { readonly orgId: OrgId; readonly jobId: string }):
    Promise<{ readonly projectId: string; readonly job: ExportJobRecord } | null>;
}

/**
 * The zip container format, as a port.
 *
 * `lint-arch-deps.mjs` forbids the application layer importing `infrastructure` directly --
 * `export-artifacts.ts` needs to turn (path, bytes) pairs into one zip archive, and the actual
 * byte-level format (`infrastructure/files/zip-codec.ts`) is exactly the kind of "how" the
 * onion rule keeps out of a use case. This port is the seam; `NodeZipBuilder` is its one
 * implementation.
 */
export interface ZipEntry {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface ZipBuilder {
  build(entries: readonly ZipEntry[]): Uint8Array;
}

export const EXPORT_CONTENT_REPOSITORY = Symbol("ExportContentRepository");
export const EXPORT_JOB_REPOSITORY = Symbol("ExportJobRepository");
export const ZIP_BUILDER = Symbol("ZipBuilder");
